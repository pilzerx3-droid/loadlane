import { Module } from "@nestjs/common";
import { OrganizationController } from "./organization.controller.ts";

/** The organization (tenant) itself: its settings and, later, its creation. */
@Module({ controllers: [OrganizationController] })
export class OrganizationsModule {}
