import { basename } from 'node:path';
import { normalizeUrl } from './config.ts';

/** Keep downloads inside the working directory — never honor `../` or absolute names. */
export function safeDownloadName(name: string): string {
	const base = basename(name.replaceAll('\\', '/'));
	if (!base || base === '.' || base === '..') return 'attachment';
	return base;
}

export class QuickMailError extends Error {
	constructor(
		readonly status: number,
		message: string
	) {
		super(message);
		this.name = 'QuickMailError';
	}
}

export type MailboxView = 'inbox' | 'starred' | 'drafts' | 'sent' | 'trash';

export type ThreadSummary = {
	thread_id: string;
	latest_id: string;
	subject: string;
	preview: string;
	participants: { label: string; address: string; self: boolean }[];
	message_count: number;
	is_read: boolean;
	is_starred: boolean;
	created_at: string;
};

export type ThreadMessage = {
	id: string;
	direction: 'inbound' | 'outbound';
	from_addr: string;
	to_addr: string;
	cc_addr: string | null;
	subject: string;
	body_text: string | null;
	body_html: string | null;
	created_at: string;
	attachments: {
		id: string;
		filename: string;
		content_type: string;
		size_bytes: number;
	}[];
};

export type MailboxPage = {
	threads: ThreadSummary[];
	total: number;
	page: number;
	pageCount: number;
	pageSize: number;
};

export type User = {
	id: string;
	email: string;
	name: string;
	is_admin: boolean;
};

export type Domain = {
	id: string;
	name: string;
	status: string;
	sending_enabled: boolean;
	receiving_enabled: boolean;
};

export type MailAddress = {
	id: string;
	user_id: string;
	domain_id: string;
	domain_name: string;
	address: string;
	is_default: boolean;
};

export type UnroutedEmail = {
	id: string;
	from_addr: string;
	to_addr: string;
	subject: string | null;
	reason: string;
	created_at: string;
};

export type ListThreadsQuery = {
	view?: MailboxView;
	q?: string;
	page?: number;
	unread?: boolean;
	starred?: boolean;
	attachments?: boolean;
	domain?: string;
};

export class QuickMailClient {
	readonly url: string;

	constructor(
		url: string,
		readonly token: string
	) {
		this.url = normalizeUrl(url);
	}

	async request<T>(path: string, init: RequestInit = {}): Promise<T> {
		const headers = new Headers(init.headers);
		headers.set('authorization', `Bearer ${this.token}`);
		headers.set('accept', 'application/json');
		if (init.body && !headers.has('content-type')) {
			headers.set('content-type', 'application/json');
		}

		const res = await fetch(`${this.url}${path}`, { ...init, headers });
		if (res.headers.get('content-type')?.includes('application/json')) {
			const body = (await res.json()) as T & { error?: string };
			if (!res.ok) {
				throw new QuickMailError(res.status, body.error ?? res.statusText);
			}
			return body;
		}

		if (!res.ok) {
			throw new QuickMailError(res.status, res.statusText);
		}
		return undefined as T;
	}

	async whoami(): Promise<User> {
		const body = await this.request<{ user: User }>('/api/auth/me');
		return body.user;
	}

	async listThreads(query: ListThreadsQuery = {}): Promise<MailboxPage> {
		const params = new URLSearchParams();
		if (query.view) params.set('view', query.view);
		if (query.q) params.set('q', query.q);
		if (query.page && query.page > 1) params.set('page', String(query.page));
		if (query.unread) params.set('unread', '1');
		if (query.starred) params.set('starred', '1');
		if (query.attachments) params.set('attachments', '1');
		if (query.domain) params.set('domain', query.domain);
		const suffix = params.size > 0 ? `?${params}` : '';
		return this.request<MailboxPage>(`/api/mail${suffix}`);
	}

	async getThread(id: string): Promise<{ threadId: string; subject: string; messages: ThreadMessage[] }> {
		return this.request(`/api/mail/${encodeURIComponent(id)}`);
	}

	async sendMessage(input: {
		to: string;
		subject: string;
		text?: string;
		html?: string;
		cc?: string;
		bcc?: string;
		fromAddressId?: string;
	}): Promise<{ id: string }> {
		return this.request('/api/mail', {
			method: 'POST',
			body: JSON.stringify(input)
		});
	}

	async reply(id: string, input: { text?: string; html?: string; fromAddressId?: string }): Promise<{ id: string }> {
		return this.request(`/api/mail/${encodeURIComponent(id)}`, {
			method: 'POST',
			body: JSON.stringify(input)
		});
	}

	async listAddresses(all = false): Promise<MailAddress[]> {
		const suffix = all ? '?all=1' : '';
		const body = await this.request<{ addresses: MailAddress[] }>(`/api/addresses${suffix}`);
		return body.addresses;
	}

	async downloadAttachment(emailId: string, attachmentId: string): Promise<{ bytes: Uint8Array; filename: string; type: string }> {
		const res = await fetch(
			`${this.url}/api/mail/${encodeURIComponent(emailId)}/attachments/${encodeURIComponent(attachmentId)}?download=1`,
			{ headers: { authorization: `Bearer ${this.token}` } }
		);
		if (!res.ok) {
			throw new QuickMailError(res.status, 'Failed to download attachment');
		}

		const disposition = res.headers.get('content-disposition') ?? '';
		const match = /filename="([^"]+)"/.exec(disposition);
		const filename = safeDownloadName(match ? decodeURIComponent(match[1]) : attachmentId);

		return {
			bytes: new Uint8Array(await res.arrayBuffer()),
			filename,
			type: res.headers.get('content-type') ?? 'application/octet-stream'
		};
	}

	async listUsers(): Promise<{ users: User[]; addresses: MailAddress[] }> {
		return this.request('/api/admin/users');
	}

	async createUser(input: {
		name: string;
		domainId: string;
		localPart: string;
		password: string;
	}): Promise<{ user: User; address: MailAddress }> {
		return this.request('/api/admin/users', {
			method: 'POST',
			body: JSON.stringify(input)
		});
	}

	async deleteUser(id: string): Promise<void> {
		await this.request(`/api/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE' });
	}

	async resetPassword(id: string, password: string): Promise<void> {
		await this.request(`/api/admin/users/${encodeURIComponent(id)}`, {
			method: 'PATCH',
			body: JSON.stringify({ password })
		});
	}

	async listDomains(): Promise<{ connected: Domain[]; available: { id: string; name: string; connected: boolean }[] }> {
		return this.request('/api/domains');
	}

	async connectDomain(domainId: string): Promise<void> {
		await this.request('/api/domains', {
			method: 'POST',
			body: JSON.stringify({ domainId })
		});
	}

	async disconnectDomain(id: string): Promise<void> {
		await this.request(`/api/domains/${encodeURIComponent(id)}`, { method: 'DELETE' });
	}

	async createAddress(input: {
		domainId: string;
		localPart: string;
		userId?: string;
		label?: string;
	}): Promise<MailAddress> {
		const body = await this.request<{ address: MailAddress }>('/api/addresses', {
			method: 'POST',
			body: JSON.stringify(input)
		});
		return body.address;
	}

	async listUnrouted(limit = 50): Promise<UnroutedEmail[]> {
		const body = await this.request<{ unrouted: UnroutedEmail[] }>(
			`/api/admin/unrouted?limit=${limit}`
		);
		return body.unrouted;
	}
}
