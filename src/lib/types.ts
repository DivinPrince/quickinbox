export type User = {
	id: string;
	email: string;
	name: string;
	is_admin: boolean;
	must_change_password: boolean;
	created_at: string;
};

export type ApiScope = 'mail:send' | 'mail:read' | 'admin';

export type ApiTokenSummary = {
	id: string;
	name: string;
	preview: string;
	scopes: ApiScope[];
	created_at: string;
	last_used_at: string | null;
};

export type DeliveryStatus =
	| 'queued'
	| 'sent'
	| 'delivered'
	| 'delayed'
	| 'bounced'
	| 'complained'
	| 'failed';

/** What the `emails.status` column can hold — delivery state, or an unsent draft. */
export type MailStatus = DeliveryStatus | 'draft';

export type Domain = {
	id: string;
	name: string;
	status: string;
	region: string | null;
	sending_enabled: boolean;
	receiving_enabled: boolean;
	catchall_user_id: string | null;
	created_at: string;
	synced_at: string | null;
};

/** Which mail backend this deploy is configured to use. */
export type EmailProviderKind = 'resend' | 'cloudflare';

/** A domain as reported by the active provider, flagged with local connection state. */
export type AvailableDomain = {
	id: string;
	name: string;
	status: string;
	region: string | null;
	can_send: boolean;
	can_receive: boolean;
	connected: boolean;
};

export type MailAddress = {
	id: string;
	user_id: string;
	domain_id: string;
	domain_name: string;
	address: string;
	/** From display name on outbound mail. Falls back to the account name. */
	label: string | null;
	is_default: boolean;
	/** Sign-off for this mailbox. Falls back to the account signature when empty. */
	signature: string | null;
	created_at: string;
};

/** The mailboxes the sidebar can show. Drafts/Trash are flags, not folders. */
export type MailboxView = 'inbox' | 'archive' | 'starred' | 'drafts' | 'sent' | 'trash';

export type MailboxCounts = {
	inbox: number;
	inbox_unread: number;
	archive: number;
	starred: number;
	drafts: number;
	sent: number;
	trash: number;
};

export type EmailRow = {
	id: string;
	user_id: string;
	direction: 'inbound' | 'outbound';
	from_addr: string;
	from_name: string | null;
	to_addr: string;
	cc_addr: string | null;
	bcc_addr: string | null;
	subject: string;
	body_text: string | null;
	body_html: string | null;
	message_id: string | null;
	in_reply_to: string | null;
	references_header: string | null;
	reply_to_email_id: string | null;
	/** Conversation this message belongs to; the id of its oldest message. */
	thread_id: string | null;
	/** Subject with Re:/Fwd: stripped — backs subject-based thread matching. */
	thread_key: string | null;
	domain_id: string | null;
	/** The registered address that received the message; null for catch-all. */
	address_id: string | null;
	provider_id: string | null;
	status: MailStatus | null;
	status_at: string | null;
	status_detail: string | null;
	is_read: number;
	is_starred: number;
	deleted_at: string | null;
	archived_at: string | null;
	created_at: string;
};

export type EmailSummary = {
	id: string;
	direction: 'inbound' | 'outbound';
	from_addr: string;
	to_addr: string;
	subject: string;
	/** First line of the body, shown next to the subject in the list. */
	preview: string;
	is_read: boolean;
	is_starred: boolean;
	is_draft: boolean;
	is_archived: boolean;
	has_attachments: boolean;
	domain_id: string | null;
	address_id: string | null;
	status: DeliveryStatus | null;
	created_at: string;
};

/** Who took part in a conversation, in the order they first appear. */
export type ThreadParticipant = {
	label: string;
	address: string;
	/** True for messages this user sent — rendered as "me". */
	self: boolean;
};

/** One row in a mailbox list: a whole conversation, not a single message. */
export type ThreadSummary = {
	thread_id: string;
	/** Newest message in the conversation — what the row opens. */
	latest_id: string;
	/** The original subject, without the accumulated Re: prefixes. */
	subject: string;
	preview: string;
	participants: ThreadParticipant[];
	message_count: number;
	/** False when any message in the conversation is unread. */
	is_read: boolean;
	is_starred: boolean;
	is_draft: boolean;
	is_archived: boolean;
	has_attachments: boolean;
	domain_id: string | null;
	/** Which registered address the newest message arrived on, when known. */
	address_id: string | null;
	/** Delivery state of the newest message, when we sent it. */
	status: DeliveryStatus | null;
	created_at: string;
};

export type MailboxFilters = {
	q: string;
	unreadOnly: boolean;
	starredOnly: boolean;
	attachmentsOnly: boolean;
	/** Registered address to narrow the list to; empty for all addresses. */
	addressId: string;
};

export type MailboxPage = {
	threads: ThreadSummary[];
	total: number;
	page: number;
	pageCount: number;
	pageSize: number;
};

/** A single message inside an open conversation. */
export type ThreadMessage = {
	id: string;
	direction: 'inbound' | 'outbound';
	from_addr: string;
	from_name: string | null;
	to_addr: string;
	cc_addr: string | null;
	subject: string;
	body_text: string | null;
	body_html: string | null;
	message_id: string | null;
	references_header: string | null;
	status: DeliveryStatus | null;
	status_detail: string | null;
	is_read: boolean;
	is_starred: boolean;
	deleted_at: string | null;
	archived_at: string | null;
	created_at: string;
	attachments: EmailAttachmentMeta[];
};

export type EmailAttachmentMeta = {
	id: string;
	email_id: string;
	filename: string;
	content_type: string;
	size_bytes: number;
	created_at: string;
};

export type OutboundAttachmentInput = {
	filename: string;
	type: string;
	content: string;
};
