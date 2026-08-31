<script lang="ts">
	import { page } from '$app/stores';
	import { invalidateAll } from '$app/navigation';
	import EmailBody from '$lib/components/EmailBody.svelte';
	import RichTextEditor from '$lib/components/RichTextEditor.svelte';
	import Tooltip from '$lib/components/Tooltip.svelte';
	import { htmlToPlainText, isHtmlEmpty } from '$lib/utils/html';
	import { formatMailDate, formatMailTime, shouldShowSeparateTime } from '$lib/utils/date';
	import { attachmentHref } from '$lib/utils/attachments';
	import { runMailAction } from '$lib/mail/client';
	import { initials, parseAddressList, type AddressPart } from '$lib/mail/folders';
	import { t } from '$lib/i18n';
	import type { MailAddress, MailboxView, OutboundAttachmentInput, ThreadMessage } from '$lib/types';
	import type { ZeroIconName } from '../icons/names';
	import Icon from '../icons/Icon.svelte';
	import ComposerActions from '../overlays/ComposerActions.svelte';

	let {
		id,
		view,
		onClose,
		onCompose,
		onRead
	}: {
		id: string | null;
		view: MailboxView;
		onClose: () => void;
		onCompose?: () => void;
		onRead?: (threadId: string) => void;
	} = $props();

	type ThreadPayload = {
		threadId: string;
		subject: string;
		messages: ThreadMessage[];
	};

	type ReplyMode = 'reply' | 'replyAll' | 'forward' | 'forwardAll';

	let thread = $state<ThreadPayload | null>(null);
	let loading = $state(false);
	let error = $state('');
	let opened = $state<Set<string>>(new Set());
	let replyOpen = $state(false);
	let replyMode = $state<ReplyMode>('reply');
	let replyTarget = $state<ThreadMessage | null>(null);
	let replyHtml = $state('');
	let replyTo = $state('');
	let replyCc = $state('');
	let showCc = $state(false);
	let showBcc = $state(false);
	let replyBcc = $state('');
	let attachments = $state<OutboundAttachmentInput[]>([]);
	let includeOriginalAttachments = $state(true);
	let sending = $state(false);
	let sendError = $state('');
	let dark = $state(false);
	let detailsFor = $state<string | null>(null);
	let menuFor = $state<string | null>(null);

	const selfEmails = $derived(
		new Set(
			(($page.data.addresses as MailAddress[] | undefined) ?? []).map((address) =>
				address.address.toLowerCase()
			)
		)
	);

	$effect(() => {
		dark = document.documentElement.dataset.theme === 'dark';
	});

	$effect(() => {
		const current = id;
		if (!current) {
			thread = null;
			return;
		}
		let cancelled = false;
		loading = true;
		error = '';
		replyOpen = false;
		detailsFor = null;
		menuFor = null;
		void fetch(`/api/mail/${current}`)
			.then(async (response) => {
				const body = (await response.json()) as ThreadPayload & { error?: string };
				if (cancelled) return;
				if (!response.ok) {
					error = body.error ?? t('thread.couldNotLoad');
					thread = null;
					return;
				}
				thread = body;
				const last = body.messages[body.messages.length - 1];
				opened = new Set(last ? [last.id] : []);
				onRead?.(body.threadId);
			})
			.catch(() => {
				if (!cancelled) error = t('common.networkError');
			})
			.finally(() => {
				if (!cancelled) loading = false;
			});
		return () => {
			cancelled = true;
		};
	});

	const latest = $derived(thread?.messages[thread.messages.length - 1] ?? null);
	const starred = $derived(thread?.messages.some((message) => message.is_starred) ?? false);
	const people = $derived(thread ? threadPeople(thread.messages, selfEmails) : []);
	const forwarding = $derived(replyMode === 'forward' || replyMode === 'forwardAll');
	const forwardedMessages = $derived(
		replyMode === 'forwardAll'
			? (thread?.messages ?? [])
			: replyMode === 'forward' && replyTarget
				? [replyTarget]
				: []
	);
	const forwardedAttachmentCount = $derived(
		forwardedMessages.reduce((count, message) => count + message.attachments.length, 0)
	);

	function senderName(message: ThreadMessage): string {
		if (message.direction === 'outbound') return t('common.me');
		return message.from_name || message.from_addr;
	}

	function senderEmail(message: ThreadMessage): string {
		if (message.direction === 'outbound') {
			return parseAddressList(message.from_addr)[0]?.email ?? message.from_addr;
		}
		return message.from_addr;
	}

	function threadPeople(messages: ThreadMessage[], self: Set<string>): AddressPart[] {
		const found: AddressPart[] = [];
		const seen = new Set<string>();
		const add = (person: AddressPart) => {
			if (self.has(person.email) || seen.has(person.email)) return;
			seen.add(person.email);
			found.push(person);
		};
		for (const message of messages) {
			if (message.direction === 'inbound') {
				const sender = parseAddressList(message.from_addr)[0];
				add({
					name: message.from_name || sender?.name || message.from_addr,
					email: sender?.email ?? message.from_addr.toLowerCase()
				});
			}
			for (const person of parseAddressList(message.to_addr)) add(person);
			for (const person of parseAddressList(message.cc_addr)) add(person);
		}
		return found;
	}

	function toLine(message: ThreadMessage): string {
		const recipients = [
			...parseAddressList(message.to_addr),
			...parseAddressList(message.cc_addr)
		];
		if (recipients.length === 0) return message.to_addr;
		if (view !== 'sent' && recipients.length === 1 && selfEmails.has(recipients[0].email)) {
			return 'You';
		}
		const visible = recipients.slice(0, 3).map((person) =>
			selfEmails.has(person.email) ? 'You' : person.name || person.email
		);
		const extra = recipients.length - visible.length;
		return extra > 0 ? `${visible.join(', ')}, +${extra} others` : visible.join(', ');
	}

	function attachIcon(filename: string, type: string): ZeroIconName {
		const extension = filename.split('.').pop()?.toLowerCase() ?? '';
		if (extension === 'pdf' || type === 'application/pdf') return 'PDF';
		if (extension === 'fig' || type.includes('figma')) return 'Figma';
		if (extension === 'doc' || extension === 'docx' || type.includes('word')) return 'Docx';
		if (type.startsWith('image/')) return 'ImageFile';
		return 'Paper';
	}

	function recipientsFor(mode: ReplyMode, message: ThreadMessage): { to: string; cc: string } {
		switch (mode) {
			case 'forward':
			case 'forwardAll':
				return { to: '', cc: '' };
			case 'reply': {
				const to =
					message.direction === 'inbound'
						? formatIdentity(message.from_name, message.from_addr)
						: message.to_addr;
				return { to, cc: '' };
			}
			case 'replyAll': {
				const to =
					message.direction === 'inbound'
						? formatIdentity(message.from_name, message.from_addr)
						: message.to_addr;
				const toEmail = parseAddressList(to)[0]?.email ?? to.toLowerCase();
				const extras = [...parseAddressList(message.to_addr), ...parseAddressList(message.cc_addr)]
					.filter((person) => !selfEmails.has(person.email) && person.email !== toEmail)
					.map((person) => formatIdentity(person.name, person.email));
				return { to, cc: extras.join(', ') };
			}
			default: {
				const _exhaustive: never = mode;
				throw new Error(`Unhandled reply mode: ${_exhaustive}`);
			}
		}
	}

	function formatIdentity(name: string | null | undefined, email: string): string {
		const cleanName = name?.trim();
		if (cleanName && cleanName.toLowerCase() !== email.toLowerCase()) {
			return `${cleanName} <${email}>`;
		}
		return email;
	}

	async function act(action: string) {
		if (!latest) return;
		menuFor = null;
		await runMailAction(action, [latest.id]);
		onClose();
		await invalidateAll();
	}

	async function toggleStar() {
		if (!latest) return;
		await runMailAction(starred ? 'unstar' : 'star', [latest.id]);
		await invalidateAll();
		if (thread) {
			thread = {
				...thread,
				messages: thread.messages.map((message) => ({ ...message, is_starred: !starred }))
			};
		}
	}

	function startReply(mode: ReplyMode, message: ThreadMessage) {
		replyMode = mode;
		replyTarget = message;
		replyOpen = true;
		const next = recipientsFor(mode, message);
		replyTo = next.to;
		replyCc = next.cc;
		replyBcc = '';
		showCc = Boolean(next.cc);
		showBcc = false;
		replyHtml = '';
		sendError = '';
		attachments = [];
		includeOriginalAttachments = true;
		const nextOpened = new Set(opened);
		nextOpened.add(message.id);
		opened = nextOpened;
	}

	function startForwardAll() {
		if (!latest) return;
		startReply('forwardAll', latest);
	}

	function toggleOpened(messageId: string) {
		const next = new Set(opened);
		if (next.has(messageId) && next.size > 1) next.delete(messageId);
		else next.add(messageId);
		opened = next;
	}

	function closeMenus() {
		detailsFor = null;
		menuFor = null;
	}

	function onThreadKey(event: KeyboardEvent) {
		if (!id || !thread || !latest) return;
		const target = event.target as HTMLElement | null;
		if (
			target &&
			(target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
		) {
			if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && replyOpen) {
				event.preventDefault();
				void sendReply();
			}
			return;
		}
		if (event.key === 'r') startReply('reply', latest);
		if (event.key === 'a') startReply('replyAll', latest);
		if (event.key === 'f') startReply('forward', latest);
		if (event.key === 'Escape' && replyOpen) {
			replyOpen = false;
		}
	}

	async function sendReply() {
		const message = replyTarget ?? latest;
		if (!message || (!forwarding && isHtmlEmpty(replyHtml))) return;
		if (forwarding && !replyTo.trim()) {
			sendError = t('thread.addRecipient');
			return;
		}
		sending = true;
		sendError = '';
		try {
			if (forwarding) {
				const endpoint =
					replyMode === 'forwardAll' && thread
						? `/api/mail/thread/${encodeURIComponent(thread.threadId)}/forward`
						: `/api/mail/${encodeURIComponent(message.id)}/forward`;
				const response = await fetch(endpoint, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						to: replyTo,
						cc: replyCc.trim() || undefined,
						bcc: replyBcc.trim() || undefined,
						html: isHtmlEmpty(replyHtml) ? undefined : replyHtml,
						text: isHtmlEmpty(replyHtml) ? undefined : htmlToPlainText(replyHtml),
						includeAttachments: includeOriginalAttachments
					})
				});
				if (!response.ok) {
					const body = (await response.json()) as { error?: string };
					sendError = body.error ?? t('thread.couldNotForward');
					return;
				}
			} else {
				const response = await fetch(`/api/mail/${message.id}`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						to: replyTo,
						cc: replyCc.trim() || undefined,
						bcc: replyBcc.trim() || undefined,
						html: replyHtml,
						text: htmlToPlainText(replyHtml),
						attachments
					})
				});
				if (!response.ok) {
					const body = (await response.json()) as { error?: string };
					sendError = body.error ?? t('thread.couldNotSendReply');
					return;
				}
			}
			replyOpen = false;
			replyHtml = '';
			attachments = [];
			await invalidateAll();
		} catch {
			sendError = t('common.networkError');
		} finally {
			sending = false;
		}
	}

	function visiblePeople(list: AddressPart[]): { shown: AddressPart[]; extra: number } {
		if (list.length <= 2) return { shown: list, extra: 0 };
		return { shown: list.slice(0, 2), extra: list.length - 2 };
	}
</script>

<svelte:window
	onkeydown={onThreadKey}
	onclick={closeMenus}
/>

{#if !id}
	<div class="z-empty">
		<img src={dark ? '/themes/zero/empty-state.svg' : '/themes/zero/empty-state-light.svg'} alt="" />
		<p class="z-empty-title">{t('mailbox.empty.zero')}</p>
		<p class="z-empty-copy">{t('thread.chooseEmail')}</p>
		{#if onCompose}
			<button type="button" class="z-ghost-btn" onclick={onCompose}>
				<Icon name="Mail" size={14} />
				{t('thread.sendEmail')}
			</button>
		{/if}
	</div>
{:else if loading}
	<div class="z-empty">{t('common.loading')}</div>
{:else if error}
	<div class="z-empty">{error}</div>
{:else if thread && latest}
	<div class="z-thread">
		<div class="z-thread-bar">
			<Tooltip text={t('thread.close')}>
				<button type="button" class="z-thread-icon" aria-label={t('thread.close')} onclick={onClose}>
					<Icon name="X" size={14} />
				</button>
			</Tooltip>
			<div class="z-thread-bar-right">
				<button type="button" class="z-thread-replyall" onclick={startForwardAll}>
					<Icon name="Forward" size={14} />
					<span>{t('thread.forwardAll')}</span>
				</button>
				<button
					type="button"
					class="z-thread-replyall"
					onclick={() => startReply('replyAll', latest)}
				>
					<Icon name="Reply" size={14} />
					<span>{t('thread.replyAll')}</span>
				</button>
				<Tooltip text={starred ? t('mailbox.unstar') : t('mailbox.star')}>
					<button
						type="button"
						class="z-thread-icon"
						aria-label={starred ? t('mailbox.unstar') : t('mailbox.star')}
						onclick={toggleStar}
					>
						<Icon name="Star2" class={starred ? 'z-star-on' : ''} size={16} />
					</button>
				</Tooltip>
				<Tooltip text={view === 'archive' ? t('mailbox.moveToInbox') : t('nav.archive')}>
					<button
						type="button"
						class="z-thread-icon"
						aria-label={view === 'archive' ? t('mailbox.moveToInbox') : t('nav.archive')}
						onclick={() => act(view === 'archive' ? 'unarchive' : 'archive')}
					>
						<Icon name="Archive2" size={16} />
					</button>
				</Tooltip>
				{#if view !== 'trash'}
					<Tooltip text={t('nav.bin')}>
						<button type="button" class="z-thread-trash" aria-label={t('nav.bin')} onclick={() => act('trash')}>
							<Icon name="Trash" size={16} />
						</button>
					</Tooltip>
				{/if}
				<div class="z-thread-menu">
					<Tooltip text={t('thread.more')}>
						<button
							type="button"
							class="z-thread-icon"
							aria-label={t('thread.more')}
							onclick={(event) => {
								event.stopPropagation();
								menuFor = menuFor === 'thread' ? null : 'thread';
								detailsFor = null;
							}}
						>
							<Icon name="ThreeDots" size={12} />
						</button>
					</Tooltip>
					{#if menuFor === 'thread'}
						<div class="z-pop" role="menu" tabindex="-1" onpointerdown={(event) => event.stopPropagation()}>
							{#if view === 'archive' || view === 'trash'}
								<button type="button" onclick={() => act(view === 'trash' ? 'restore' : 'unarchive')}>
									<Icon name="Inbox" size={14} />
									{t('mailbox.moveToInbox')}
								</button>
							{:else}
								<button type="button" onclick={() => act('archive')}>
									<Icon name="Archive2" size={14} />
									{t('nav.archive')}
								</button>
							{/if}
						</div>
					{/if}
				</div>
			</div>
		</div>

		<div class="z-thread-body">
			<div class="z-thread-hero">
				<h1 class="z-thread-subject">
					{thread.subject || t('mailbox.noSubject')}
					{#if thread.messages.length > 1}
						<span class="z-thread-count">[{thread.messages.length}]</span>
					{/if}
				</h1>
				{#if people.length > 0}
					{@const chips = visiblePeople(people)}
					<div class="z-people">
						{#each chips.shown as person (person.email)}
							<span class="z-person-chip">
								<span class="z-avatar z-avatar-sm">{initials(person.name)}</span>
								{person.name}
							</span>
						{/each}
						{#if chips.extra > 0}
							<span class="z-people-more">+{chips.extra}</span>
						{/if}
					</div>
				{/if}
			</div>

			{#each thread.messages as message, index (message.id)}
				{@const last = index === thread.messages.length - 1}
				{@const isOpen = opened.has(message.id)}
				<article class="z-msg" class:open={isOpen}>
					<div
						class="z-msg-head"
						role="button"
						tabindex="0"
						onclick={() => toggleOpened(message.id)}
						onkeydown={(event) => {
							if (event.key === 'Enter' || event.key === ' ') {
								event.preventDefault();
								toggleOpened(message.id);
							}
						}}
					>
						<span class="z-avatar">{initials(senderName(message))}</span>
						<div class="z-msg-meta">
							<div class="z-msg-meta-top">
								<div class="z-msg-who">
									<span class="z-msg-name">{senderName(message)}</span>
									<button
										type="button"
										class="z-details"
										onclick={(event) => {
											event.stopPropagation();
											detailsFor = detailsFor === message.id ? null : message.id;
											menuFor = null;
										}}
									>
										{t('thread.details')}
									</button>
									{#if detailsFor === message.id}
										<div class="z-details-pop" role="dialog" onpointerdown={(event) => event.stopPropagation()}>
											<div><span>{t('thread.fromColon')}</span> {senderName(message)} {senderEmail(message)}</div>
											<div><span>{t('thread.toColon')}</span> {message.to_addr}</div>
											{#if message.cc_addr}
												<div><span>{t('thread.ccColon')}</span> {message.cc_addr}</div>
											{/if}
											<div><span>{t('thread.dateColon')}</span> {formatMailDate(message.created_at, $page.data.locale)} {formatMailTime(message.created_at, $page.data.locale)}</div>
										</div>
									{/if}
								</div>
								<div class="z-msg-when">
									<time>{formatMailDate(message.created_at, $page.data.locale)}</time>
									{#if shouldShowSeparateTime(message.created_at)}
										<time class="z-msg-time">{formatMailTime(message.created_at, $page.data.locale)}</time>
									{/if}
									<Tooltip text={t('thread.messageActions')}>
										<button
											type="button"
											class="z-thread-icon z-msg-more"
											aria-label={t('thread.messageActions')}
											onclick={(event) => {
												event.stopPropagation();
												menuFor = menuFor === message.id ? null : message.id;
												detailsFor = null;
											}}
										>
											<Icon name="ThreeDots" size={12} />
										</button>
									</Tooltip>
									{#if menuFor === message.id}
										<div class="z-pop z-pop-msg" role="menu" tabindex="-1" onpointerdown={(event) => event.stopPropagation()}>
											<button type="button" onclick={() => startReply('reply', message)}>
												<Icon name="Reply" size={14} />
												{t('thread.reply')}
											</button>
											<button type="button" onclick={() => startReply('forward', message)}>
												<Icon name="Forward" size={14} />
												{t('thread.forward')}
											</button>
										</div>
									{/if}
								</div>
							</div>
							<p class="z-msg-to">{t('thread.toColon')} {toLine(message)}</p>
						</div>
					</div>

					{#if isOpen}
						<div class="z-msg-body">
							<div class="z-msg-html">
								{#if message.body_html}
									<EmailBody html={message.body_html} />
								{:else}
									<pre class="z-msg-text">{message.body_text}</pre>
								{/if}
							</div>
							{#if message.attachments.length > 0}
								<div class="z-attach-row">
									{#each message.attachments as file (file.id)}
										<a
											class="z-attach-file"
											href={attachmentHref(message.id, file.id)}
											target="_blank"
											rel="noopener noreferrer"
										>
											<Icon name={attachIcon(file.filename, file.content_type)} size={14} />
											<span class="z-attach-name">{file.filename}</span>
										</a>
									{/each}
								</div>
							{/if}
							<div class="z-msg-actions">
								<button type="button" class="z-action-btn" onclick={() => startReply('reply', message)}>
									<Icon name="Reply" size={14} />
									<span class="z-action-label">{t('thread.reply')}</span>
									{#if last}<kbd>r</kbd>{/if}
								</button>
								<button type="button" class="z-action-btn" onclick={() => startReply('replyAll', message)}>
									<Icon name="ReplyAll" size={14} />
									<span class="z-action-label">{t('thread.replyAllLabel')}</span>
									{#if last}<kbd>a</kbd>{/if}
								</button>
								<button type="button" class="z-action-btn" onclick={() => startReply('forward', message)}>
									<Icon name="Forward" size={14} />
									<span class="z-action-label">{t('thread.forward')}</span>
									{#if last}<kbd>f</kbd>{/if}
								</button>
							</div>
						</div>
					{/if}
				</article>
			{/each}

			{#if replyOpen}
				<form
					class="z-reply"
					onsubmit={(event) => {
						event.preventDefault();
						void sendReply();
					}}
				>
					{#if forwarding}
						<p class="z-forward-context">
							{replyMode === 'forwardAll'
								? t('thread.forwardingAll', { count: forwardedMessages.length })
								: t('thread.forwardingOne')}
						</p>
					{/if}
					<div class="z-composer-fields">
						<div class="z-composer-row">
							<span class="z-composer-label">{t('compose.toColon')}</span>
							<input class="z-composer-input" bind:value={replyTo} placeholder={t('compose.emailPlaceholder')} />
							<div class="z-composer-row-actions">
								<button type="button" class="z-composer-link" onclick={() => (showCc = !showCc)}>{t('compose.cc')}</button>
								<button type="button" class="z-composer-link" onclick={() => (showBcc = !showBcc)}>{t('compose.bcc')}</button>
								<Tooltip text={t('common.close')}>
									<button
										type="button"
										class="z-composer-link"
										aria-label={t('common.close')}
										onclick={() => (replyOpen = false)}
									>
										<Icon name="X" size={14} />
									</button>
								</Tooltip>
							</div>
						</div>
						{#if showCc}
							<div class="z-composer-row">
								<span class="z-composer-label">{t('compose.ccColon')}</span>
								<input class="z-composer-input" bind:value={replyCc} placeholder={t('compose.ccPlaceholder')} />
							</div>
						{/if}
						{#if showBcc}
							<div class="z-composer-row">
								<span class="z-composer-label">{t('compose.bccColon')}</span>
								<input class="z-composer-input" bind:value={replyBcc} placeholder={t('compose.bccPlaceholder')} />
							</div>
						{/if}
					</div>
					<div class="z-composer-body">
						<RichTextEditor
							bind:html={replyHtml}
							embedded
							minHeight={80}
							placeholder={t(forwarding ? 'thread.notePlaceholder' : 'compose.writeReplyPlaceholder')}
						/>
					</div>
					<ComposerActions
						bind:attachments
						bind:includeOriginalAttachments
						sending={sending}
						error={sendError}
						allowNewAttachments={!forwarding}
						originalAttachmentCount={forwardedAttachmentCount}
					/>
				</form>
			{/if}
		</div>
	</div>
{/if}
