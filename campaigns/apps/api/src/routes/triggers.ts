
import { Elysia, t } from 'elysia'
import { timingSafeEqual } from 'node:crypto'
import { db, automations, contacts, contactIdentities } from '@naia/db'
import { eq, and, inArray } from 'drizzle-orm'
import { enrollContact, handleContactCreated, parseTriggerConfig } from '../lib/automation-triggers'
import { executeDueEnrollments } from '../lib/automation-engine'
import { generateId } from '../lib/crypto'

function phoneCandidates(digits: string): string[] {
  const set = new Set([digits])
  if (/^55\d{11}$/.test(digits) && digits[4] === '9') set.add(digits.slice(0, 4) + digits.slice(5))
  if (/^55\d{10}$/.test(digits)) set.add(digits.slice(0, 4) + '9' + digits.slice(4))
  return [...set]
}

function secretMatches(provided: string | undefined, expected: string | undefined): boolean {
  if (!provided || !expected) return false
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export const triggerRoutes = new Elysia()
  .post(
    '/v1/triggers/webhook/:automationId',
    async ({ params, query, body, headers, set }) => {
      const [automation] = await db.select().from(automations).where(eq(automations.id, params.automationId)).limit(1)
      const config = automation ? parseTriggerConfig(automation.triggerJson) : {}
      const providedKey = headers['x-webhook-key'] ?? query.key
      if (!automation || automation.type !== 'webhook' || !secretMatches(providedKey, config.secret)) {
        set.status = 404
        return { message: 'Automação não encontrada.' }
      }
      if (!automation.active) {
        set.status = 409
        return { message: 'Automação desativada.' }
      }

      const phone = body.contact.phone?.replace(/\D/g, '') || null
      const email = body.contact.email?.trim().toLowerCase() || null
      if (!phone && !email) {
        set.status = 400
        return { message: 'Informe phone ou email do contato.' }
      }

      let contact =
        (phone
          ? (
              await db
                .select()
                .from(contacts)
                .where(and(eq(contacts.workspaceId, automation.workspaceId), inArray(contacts.whatsappPhone, phoneCandidates(phone))))
                .limit(1)
            )[0]
          : undefined) ??
        (email
          ? (
              await db
                .select()
                .from(contacts)
                .where(and(eq(contacts.workspaceId, automation.workspaceId), eq(contacts.email, email)))
                .limit(1)
            )[0]
          : undefined)

      if (!contact) {
        const id = generateId()
        const name = body.contact.name?.trim() || `Contato ${phone ? `+${phone}` : email}`
        await db.insert(contacts).values({
          id,
          workspaceId: automation.workspaceId,
          name,
          whatsappPhone: phone,
          email,
          optInStatus: true,
          optInAt: new Date(),
        })
        if (phone) {
          await db
            .insert(contactIdentities)
            .values({
              id: generateId(),
              workspaceId: automation.workspaceId,
              contactId: id,
              channelType: 'whatsapp',
              channelIdentifier: phone,
              isPrimary: true,
            })
            .onConflictDoNothing()
        }
        ;[contact] = await db.select().from(contacts).where(eq(contacts.id, id)).limit(1)
        await handleContactCreated(automation.workspaceId, id)
      } else if (body.contact.name?.trim() && contact.name.startsWith('Contato ')) {
        await db
          .update(contacts)
          .set({ name: body.contact.name.trim(), updatedAt: new Date() })
          .where(eq(contacts.id, contact.id))
      }

      if (!contact) {
        set.status = 500
        return { message: 'Falha ao registrar o contato.' }
      }

      const enrollmentId = await enrollContact(automation, contact.id, body.variables ?? {}, {
        nextStepAt: new Date(Date.now() + 5 * 60 * 1000),
      })
      await executeDueEnrollments(automation.id, [enrollmentId])

      return { received: true, contactId: contact.id, enrollmentId }
    },
    {
      body: t.Object({
        contact: t.Object({
          phone: t.Optional(t.String()),
          email: t.Optional(t.String()),
          name: t.Optional(t.String()),
        }),
        variables: t.Optional(t.Record(t.String(), t.Any())),
      }),
      query: t.Object({ key: t.Optional(t.String()) }),
    },
  )
