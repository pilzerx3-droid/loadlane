import { Download, Trash2 } from "lucide-react";
import { Button, Card, CardHeader, CardTitle, Input, NativeSelect } from "@loadlane/ui";
import { deleteDocumentAction, uploadDocumentAction } from "../app/document-actions";
import {
  DOCUMENT_TYPE_LABELS,
  documentTypeLabel,
  formatBytes,
  type DocumentItem,
} from "../lib/documents";

/** Files attached to a transport: list, download, and (for people who may) upload and remove. */
export function DocumentsCard({
  transportId,
  documents,
  canManage,
  timeZone,
}: {
  transportId: string;
  documents: DocumentItem[];
  canManage: boolean;
  timeZone: string;
}) {
  const upload = uploadDocumentAction.bind(null, transportId);
  const format = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  });
  return (
    <Card className="p-5">
      <CardHeader>
        <CardTitle>Documents</CardTitle>
      </CardHeader>

      {documents.length === 0 ? (
        <p className="text-sm text-muted-foreground">No documents attached yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {documents.map((document) => (
            <li
              key={document.id}
              className="flex flex-wrap items-center justify-between gap-3 py-2.5"
            >
              <div className="min-w-0 text-sm">
                <a
                  href={`/documents/${document.id}/download`}
                  className="inline-flex items-center gap-1.5 font-medium hover:underline"
                >
                  <Download aria-hidden="true" className="size-4" />
                  <span className="truncate">{document.filename}</span>
                </a>
                <p className="text-muted-foreground">
                  {documentTypeLabel(document.type)} · {formatBytes(document.sizeBytes)} ·{" "}
                  {format.format(new Date(document.createdAt))} · {document.uploadedBy.displayName}
                </p>
              </div>
              {canManage ? (
                <form action={deleteDocumentAction.bind(null, transportId, document.id)}>
                  <Button type="submit" variant="ghost" size="sm">
                    <Trash2 aria-hidden="true" /> Remove
                  </Button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canManage ? (
        <form
          action={upload}
          className="mt-5 flex flex-wrap items-end gap-3 border-t border-border pt-4"
        >
          <div>
            <label htmlFor="document-type" className="mb-1 block text-[13px] font-semibold">
              Type
            </label>
            <NativeSelect
              id="document-type"
              name="type"
              className="w-auto"
              defaultValue="proof_of_delivery"
            >
              {Object.entries(DOCUMENT_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="min-w-48 flex-1">
            <label htmlFor="document-file" className="mb-1 block text-[13px] font-semibold">
              File
            </label>
            <Input
              id="document-file"
              name="file"
              type="file"
              required
              accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,application/pdf,image/*"
              className="h-auto py-2"
            />
          </div>
          <Button type="submit">Upload</Button>
          <p className="basis-full text-xs text-muted-foreground">
            PDF, JPEG, PNG, WebP or HEIC, up to 10 MB.
          </p>
        </form>
      ) : null}
    </Card>
  );
}
