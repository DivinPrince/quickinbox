<script lang="ts">
 let { status }: { status: { enabled: boolean; recoveryCodesRemaining: number; configured: boolean } } = $props();
 let password = $state('');
 let code = $state('');
 let enrollment = $state<{ enrollmentId: string; secret: string; uri: string } | null>(null);
 let qr = $state('');
 let busy = $state(false);
 let error = $state('');
 let recoveryCodes = $state<string[]>([]);
 let saved = $state(false);
 let done = $state(false);
 let disabled = $state(false);
 let copied = $state(false);

 async function perform(action: 'start' | 'enable' | 'regenerate' | 'disable') {
  busy = true; error = ''; copied = false;
  try {
   const response = await fetch('/api/auth/mfa', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, password, code, enrollmentId: enrollment?.enrollmentId })
   });
   const result = await response.json();
   if (!response.ok) { error = result.error ?? 'Unable to update two-factor authentication.'; return; }
   if (action === 'start') {
    enrollment = result;
    const QRCode = await import('qrcode');
    qr = await QRCode.toDataURL(result.uri, { width: 220, margin: 2, errorCorrectionLevel: 'M' });
   } else {
    recoveryCodes = result.recoveryCodes ?? [];
    disabled = action === 'disable';
    done = true; password = ''; code = ''; enrollment = null; qr = '';
   }
  } catch { error = 'Could not complete the request. If setup completed, you can sign in with your authenticator and generate new recovery codes.'; }
  finally { busy = false; }
 }
 async function copyCodes() {
  try { await navigator.clipboard.writeText(recoveryCodes.join('\n')); copied = true; }
  catch { error = 'Copy was unavailable. Select and save the codes below.'; }
 }
 function cancel() { enrollment = null; qr = ''; password = ''; code = ''; error = ''; }
</script>

<section class="surface-lg mfa-card" aria-labelledby="mfa-title">
 <div class="heading"><h2 id="mfa-title">Two-factor authentication</h2><span class="badge">{done ? (disabled ? 'Off' : 'On') : status.enabled ? 'On' : 'Off'}</span></div>
 {#if done}
  <p role="status">{disabled ? 'Two-factor authentication is off.' : 'Your account is protected with two-factor authentication.'} Existing sessions have been signed out.</p>
  {#if recoveryCodes.length}
   <h3>Save your recovery codes</h3>
   <p>Keep these somewhere safe outside this mailbox. Each code works once if you lose your authenticator. These codes are shown only now; any previous recovery codes no longer work.</p>
   <pre class="codes">{recoveryCodes.join('\n')}</pre>
   <button type="button" class="btn-ghost" onclick={copyCodes}>{copied ? 'Copied' : 'Copy recovery codes'}</button>
   <label class="saved"><input type="checkbox" bind:checked={saved} /> I have saved my recovery codes.</label>
   <p class="hint">Wait for a fresh authenticator code before signing in again.</p>
  {/if}
  <button type="button" class="btn-primary" disabled={recoveryCodes.length > 0 && !saved} onclick={() => { window.location.href = '/login'; }}>Continue to sign in</button>
 {:else if enrollment}
  <p>Scan this QR code with your authenticator app, then enter its six-digit code. Setup expires after 10 minutes.</p>
  {#if qr}<img class="qr" src={qr} width="220" height="220" alt="Authenticator setup QR code" />{/if}
  <details><summary>Enter a setup key manually</summary><code class="secret">{enrollment.secret}</code><p>Time-based code, six digits, 30 seconds.</p></details>
  <form onsubmit={(event) => { event.preventDefault(); void perform('enable'); }}>
   <label for="mfa-confirm-code">Authenticator code</label>
   <input id="mfa-confirm-code" class="auth-input" bind:value={code} required inputmode="numeric" autocomplete="one-time-code" pattern={'[0-9]{6}'} maxlength="6" placeholder="000000" />
   <p class="hint">Enabling 2FA signs out all sessions and revokes existing client credentials. Save the recovery codes shown next.</p>
   <div class="actions"><button class="btn-primary" disabled={busy}>{busy ? 'Checking…' : 'Enable two-factor authentication'}</button><button type="button" class="btn-ghost" disabled={busy} onclick={cancel}>Cancel</button></div>
  </form>
 {:else}
  <p>{status.enabled ? `An authenticator code is required when you sign in. ${status.recoveryCodesRemaining} recovery codes remain.` : 'Protect your mailbox with a code from an authenticator app, in addition to your password.'}</p>
  {#if !status.configured && !status.enabled}
   <p class="hint">Your administrator needs to configure two-factor authentication before you can enable it.</p>
  {:else}
   <form onsubmit={(event) => { event.preventDefault(); void perform(status.enabled ? 'regenerate' : 'start'); }}>
    <label for="mfa-password">Current password</label>
    <input id="mfa-password" class="auth-input" type="password" bind:value={password} required autocomplete="current-password" maxlength="1024" />
    {#if status.enabled}
     <label for="mfa-code">Authenticator or recovery code</label>
     <input id="mfa-code" class="auth-input" bind:value={code} required autocomplete="one-time-code" maxlength="64" />
     <p class="hint">Changing these settings signs out all sessions. Password resets keep two-factor authentication enabled.</p>
     <div class="actions"><button class="btn-primary" disabled={busy}>{busy ? 'Updating…' : 'Generate new recovery codes'}</button><button type="button" class="btn-ghost" disabled={busy || !password || !code} onclick={() => { void perform('disable'); }}>Turn off 2FA</button></div>
    {:else}
     <button class="btn-primary" disabled={busy}>{busy ? 'Preparing…' : 'Set up authenticator app'}</button>
    {/if}
   </form>
  {/if}
 {/if}
 {#if error}<p class="error" role="alert">{error}</p>{/if}
</section>

<style>
 .mfa-card { padding: 1.5rem; margin-bottom: 1.5rem; border: 1px solid var(--color-border); border-radius: 1rem; }
 .heading { display: flex; align-items: center; gap: .75rem; margin-bottom: .75rem; }
 h2 { font-size: 1rem; font-weight: 600; } h3 { margin-top: 1rem; font-weight: 600; }
 p { color: var(--color-text-secondary); font-size: .875rem; line-height: 1.6; margin: .65rem 0; }
 .badge { font-size: .75rem; padding: .15rem .55rem; border-radius: 1rem; background: var(--color-surface-raised); }
 form { display: grid; gap: .7rem; max-width: 32rem; margin-top: 1rem; }
 label { font-size: .875rem; } .actions { display: flex; flex-wrap: wrap; gap: .75rem; }
 .qr { background: white; border-radius: .5rem; margin: 1rem 0; }
 .secret { display: block; overflow-wrap: anywhere; margin: .75rem 0; user-select: all; }
 summary { cursor: pointer; font-size: .875rem; }
 .codes { user-select: all; line-height: 1.8; padding: 1rem; background: var(--color-surface-raised); border: 1px solid var(--color-border); border-radius: .5rem; width: fit-content; }
 .saved { display: flex; align-items: center; gap: .5rem; margin: 1rem 0; }
 .error { color: var(--color-text-primary); font-weight: 500; }
</style>
