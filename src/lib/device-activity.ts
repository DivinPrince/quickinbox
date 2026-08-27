export function formatDeviceActivity(value: string | null): string {
	if (!value) return 'Never used';
	const timestamp = Date.parse(value);
	if (!Number.isFinite(timestamp)) return 'Activity unavailable';
	const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
	if (seconds < 60) return 'Active just now';
	if (seconds < 3600) return `Active ${Math.floor(seconds / 60)} min ago`;
	if (seconds < 86400) return `Active ${Math.floor(seconds / 3600)} h ago`;
	return `Active ${Math.floor(seconds / 86400)} d ago`;
}
