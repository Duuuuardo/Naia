import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_app/$workspaceId/dashboard')({
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/$workspaceId', params: { workspaceId: params.workspaceId } })
  },
})
