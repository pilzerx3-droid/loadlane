import { Module } from "@nestjs/common";
import type pg from "pg";
import type { ObjectStorage } from "../../platform/object-storage.ts";
import { APP_POOL, OBJECT_STORAGE } from "../../platform/tokens.ts";
import { DocumentController } from "./document.controller.ts";
import { DocumentService } from "./document-service.ts";
import { DOCUMENT_SERVICE } from "./tokens.ts";

/** Files attached to transports: delivery notes, bills of lading, proof of delivery, photos. */
@Module({
  controllers: [DocumentController],
  providers: [
    {
      provide: DOCUMENT_SERVICE,
      inject: [APP_POOL, OBJECT_STORAGE],
      useFactory: (pool: pg.Pool, storage: ObjectStorage) => new DocumentService(pool, storage),
    },
  ],
})
export class DocumentsModule {}
