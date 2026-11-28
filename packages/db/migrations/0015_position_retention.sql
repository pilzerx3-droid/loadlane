ALTER TABLE "organization" ADD COLUMN "position_retention_days" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD CONSTRAINT "organization_position_retention_range" CHECK ("organization"."position_retention_days" BETWEEN 1 AND 3650);--> statement-breakpoint

-- Hand-written addition (ADR 0015): the retention job needs to list organizations to visit them one
-- by one. Only a connection that says so (app.retention_job) sees every organization row; the
-- deletes themselves stay limited to the organization the job acts for.
CREATE FUNCTION app_retention_job() RETURNS boolean LANGUAGE sql STABLE PARALLEL SAFE AS $$
	SELECT coalesce(current_setting('app.retention_job', true), '') = 'on'
$$;--> statement-breakpoint
CREATE POLICY organization_select_retention ON "organization" FOR SELECT TO loadlane_app USING (app_retention_job());
