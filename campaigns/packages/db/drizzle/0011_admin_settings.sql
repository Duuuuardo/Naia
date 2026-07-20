CREATE TABLE "product_settings" (
  "key" text PRIMARY KEY NOT NULL,
  "value" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "description" text,
  "updated_by_service" text,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "workspace_settings" (
  "workspace_id" text PRIMARY KEY NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "settings" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "updated_by_service" text,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
