<script lang="ts">
  let { text = '', query = '' }: { text?: string; query?: string } = $props();
  const parts = $derived.by(() => {
    const words = (query.slice(0, 500).match(/[\p{L}\p{N}_]+/gu) ?? []).slice(0, 20);
    if (!words.length) return [{ text, match: false }];
    const expression = new RegExp(`(${words.sort((a, b) => b.length - a.length).join('|')})`, 'giu');
    return text.split(expression).map((part, index) => ({ text: part, match: index % 2 === 1 }));
  });
</script>
{#each parts as part}{#if part.match}<mark>{part.text}</mark>{:else}{part.text}{/if}{/each}
<style>mark { background: #f9df70; color: #30250a; border-radius: 2px; }</style>
