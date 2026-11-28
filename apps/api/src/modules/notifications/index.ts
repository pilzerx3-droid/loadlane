// Public surface of the notifications module. Other modules import only from here.
export { NotificationsModule } from "./notifications.module.ts";
export { MAIL_SERVICE } from "./tokens.ts";
export type { MailService, MailOutcome, MailKind } from "./mail-service.ts";
export { quoteMail, spotInvitationMail, trackingLinkMail, usDate } from "./mail-templates.ts";
