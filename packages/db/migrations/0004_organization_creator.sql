ALTER TABLE "organization" ADD COLUMN "created_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "organization" ADD CONSTRAINT "organization_created_by_user_id_app_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "organization_created_by_idx" ON "organization" USING btree ("created_by_user_id");--> statement-breakpoint

-- Hand-written addition. A person reads their own role assignments in every organization they
-- belong to, just like their own memberships (migration 0002). The web app needs this to build the
-- navigation and the organization switcher in one query. Other people's roles stay tenant scoped.
CREATE POLICY membership_role_select_own ON "membership_role" FOR SELECT TO loadlane_app USING (
	EXISTS (
		SELECT 1 FROM "membership" m
		WHERE m.id = "membership_role".membership_id AND m.user_id = app_user_id()
	)
);
