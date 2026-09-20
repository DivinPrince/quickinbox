<script lang="ts">
	import { untrack } from 'svelte';
	import type { PageData } from './$types';
	import type { Contact } from '$lib/organizer/types';
	import { organizerRequest } from '$lib/organizer/client';
	import '$lib/organizer/organizer.css';
	let { data }: { data: PageData } = $props();
	let contacts = $state<Contact[]>(untrack(() => data.contacts));
	let total = $state(untrack(() => data.total));
	let query = $state(''),
		appliedQuery = '',
		searchRun = 0;
	let selected = $state<Contact | null>(null),
		editing = $state(false);
	let name = $state(''),
		emails = $state(''),
		company = $state(''),
		phone = $state(''),
		notes = $state(''),
		starred = $state(false);
	let busy = $state(false),
		error = $state(''),
		notice = $state('');
	let owner = untrack(() => data.user?.id);
	let seededRoute = '';
	$effect(() => {
		const current = data.user?.id;
		if (current !== owner)
			untrack(() => {
				owner = current;
				searchRun++;
				contacts = data.contacts;
				total = data.total;
				query = '';
				appliedQuery = '';
				selected = null;
				editing = false;
				busy = false;
				error = '';
				notice = '';
			});
	});
	$effect(() => {
		const route = JSON.stringify([data.user?.id, data.seed.email]);
		if (route !== seededRoute) {
			seededRoute = route;
			untrack(() => {
				if (data.existing) edit(data.existing);
				else if (data.seed.email) {
					create();
					name = data.seed.name;
					emails = data.seed.email;
				}
			});
		}
	});
	function create() {
		selected = null;
		editing = true;
		name = '';
		emails = '';
		company = '';
		phone = '';
		notes = '';
		starred = false;
		error = '';
	}
	function edit(contact: Contact) {
		selected = contact;
		editing = true;
		({ name, company, phone, notes, starred } = contact);
		emails = contact.emails.join(', ');
		error = '';
	}
	async function load(more = false) {
		const run = ++searchRun;
		try {
			const search = more ? appliedQuery : query;
			const result = await organizerRequest<{ contacts: Contact[]; total: number }>(
				`/api/contacts?q=${encodeURIComponent(search)}&offset=${more ? contacts.length : 0}`
			);
			if (run !== searchRun) return;
			contacts = more ? [...contacts, ...result.contacts] : result.contacts;
			total = result.total;
			appliedQuery = search;
		} catch (cause) {
			if (run === searchRun) error = (cause as Error).message;
		}
	}
	async function save(event: SubmitEvent) {
		event.preventDefault();
		if (busy) return;
		busy = true;
		error = '';
		notice = '';
		const savingOwner = owner;
		try {
			const result = await organizerRequest<{ contact: Contact }>(
				selected ? `/api/contacts/${selected.id}` : '/api/contacts',
				selected ? 'PUT' : 'POST',
				{
					name,
					emails: emails
						.split(/[,;\n]/)
						.map((s) => s.trim())
						.filter(Boolean),
					company,
					phone,
					notes,
					starred,
					version: selected?.version
				}
			);
			if (savingOwner !== owner) return;
			edit(result.contact);
			notice = 'Contact saved. Available in recipient suggestions.';
			await load();
		} catch (cause) {
			error = (cause as Error).message;
		} finally {
			busy = false;
		}
	}
	async function remove() {
		if (!selected || busy || !confirm(`Delete ${selected.name} from your contacts?`)) return;
		busy = true;
		error = '';
		try {
			await organizerRequest(`/api/contacts/${selected.id}`, 'DELETE', {
				version: selected.version
			});
			editing = false;
			selected = null;
			notice = 'Contact deleted.';
			await load();
		} catch (cause) {
			error = (cause as Error).message;
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>Contacts — Quickinbox</title></svelte:head>
<div class="organizer contacts-page">
	<header class="organizer-header">
		<div>
			<h1>Contacts</h1>
			<p class="subtle">Your address book, connected to mail and calendar.</p>
		</div>
		<button class="primary" onclick={create}>+ New contact</button>
	</header>
	{#if error}<p class="notice error" role="alert">{error}</p>{/if}
	{#if notice}<p class="notice" role="status">{notice}</p>{/if}
	<div class="contacts-body" class:editing>
		<section class="contact-list" aria-label="Address book">
			<form
				class="contact-search"
				onsubmit={(event) => {
					event.preventDefault();
					void load();
				}}
			>
				<input
					aria-label="Search contacts"
					type="search"
					placeholder="Search name, email, or company"
					bind:value={query}
				/><button>Search</button>
			</form>
			<p class="contact-count subtle">{total} {total === 1 ? 'contact' : 'contacts'}</p>
			{#each contacts as contact (contact.id)}
				<button
					class="contact-row"
					class:chosen={selected?.id === contact.id}
					onclick={() => edit(contact)}
				>
					<span class="avatar">{contact.name.charAt(0).toUpperCase()}</span><span
						class="contact-info"
						><strong>{contact.name}</strong><span class="subtle">{contact.emails[0]}</span
						>{#if contact.company}<small>{contact.company}</small>{/if}</span
					>{#if contact.starred}<span aria-label="Favorite">★</span>{/if}
				</button>
			{:else}<div class="empty">
					<h2>{query ? 'No matching contacts' : 'Keep your people close'}</h2>
					<p class="subtle">
						{query
							? 'Try a different name or email address.'
							: 'Add a contact here, or save someone directly from a message.'}
					</p>
				</div>{/each}
			{#if contacts.length < total}<div class="load-more">
					<button onclick={() => load(true)}>Load more</button>
				</div>{/if}
		</section>
		{#if editing}
			<section class="editor" aria-label="Contact details">
				<div class="editor-head">
					<h2>{selected ? 'Contact details' : 'New contact'}</h2>
					<button onclick={() => (editing = false)} aria-label="Close contact">✕</button>
				</div>
				{#if selected}<div class="inline-links">
						<a href={`/compose?to=${encodeURIComponent(selected.emails[0])}`}>Write email</a><a
							href={`/calendar?guest=${encodeURIComponent(selected.emails[0])}`}>Schedule event</a
						>
					</div>{/if}
				<form onsubmit={save}>
					<div class="form-grid">
						<label class="wide"
							>Name<input bind:value={name} maxlength="200" autocomplete="name" /></label
						>
						<label class="wide"
							>Email addresses<input
								bind:value={emails}
								required
								placeholder="name@example.com, work@example.com"
							/><span class="subtle">Separate multiple addresses with commas.</span></label
						>
						<label
							>Company<input
								bind:value={company}
								maxlength="200"
								autocomplete="organization"
							/></label
						><label
							>Phone<input
								type="tel"
								bind:value={phone}
								maxlength="100"
								autocomplete="tel"
							/></label
						>
						<label class="wide"
							>Notes<textarea bind:value={notes} maxlength="4000"></textarea></label
						><label class="check wide"
							><input type="checkbox" bind:checked={starred} /> Favorite contact</label
						>
					</div>
					<div class="actions">
						<button class="primary" disabled={busy}>{busy ? 'Saving…' : 'Save contact'}</button
						>{#if selected}<button class="danger" type="button" disabled={busy} onclick={remove}
								>Delete</button
							>{/if}
					</div>
				</form>
			</section>
		{/if}
	</div>
</div>

<style>
	.contacts-body {
		display: grid;
		grid-template-columns: 1fr;
		flex: 1;
		min-height: 0;
		overflow: auto;
	}
	.contacts-body.editing {
		grid-template-columns: minmax(250px, 1fr) minmax(320px, 1fr);
	}
	.contact-list {
		overflow: auto;
		padding: 8px 20px 24px;
	}
	.contact-search {
		display: flex;
		gap: 8px;
		padding: 12px 0;
		position: sticky;
		top: 0;
		background: var(--color-surface);
	}
	.contact-count {
		padding: 8px 4px 16px;
	}
	.contact-list .contact-row {
		display: flex;
		align-items: center;
		gap: 14px;
		width: 100%;
		text-align: left;
		padding: 14px 12px;
		border: 0;
		border-bottom: 1px solid var(--color-line);
		border-radius: 0;
	}
	.contact-list .chosen {
		background: var(--color-accent-soft);
		border-radius: 8px;
	}
	.avatar {
		width: 40px;
		height: 40px;
		flex: none;
		display: grid;
		place-items: center;
		background: var(--color-surface-muted);
		border-radius: 50%;
		color: var(--color-accent-text);
	}
	.contact-info {
		min-width: 0;
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 3px;
		overflow-wrap: anywhere;
	}
	.editor {
		border-left: 1px solid var(--color-line);
	}
	.load-more {
		padding: 20px;
		text-align: center;
	}
	@media (max-width: 800px) {
		.contacts-body.editing {
			display: flex;
			flex-direction: column-reverse;
			overflow: auto;
		}
		.contact-list,
		.editor {
			overflow: visible;
		}
		.editor {
			border-left: 0;
			border-bottom: 1px solid var(--color-line);
		}
	}
</style>
