export function formatRelativeDate(value: string): string {
	const date = new Date(value);
	const now = new Date();
	const diffMs = now.getTime() - date.getTime();
	const diffMins = Math.floor(diffMs / 60_000);
	const diffHours = Math.floor(diffMs / 3_600_000);
	const diffDays = Math.floor(diffMs / 86_400_000);

	if (diffMins < 1) return 'Now';
	if (diffMins < 60) return `${diffMins}m`;
	if (diffHours < 24 && date.getDate() === now.getDate()) {
		return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
	}
	if (diffDays < 7) {
		return date.toLocaleDateString([], { weekday: 'short' });
	}
	return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function formatFullDate(value: string): string {
	return new Date(value).toLocaleString([], {
		weekday: 'short',
		month: 'short',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit'
	});
}

function validDate(value: string): Date | null {
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
}

function isSameCalendarDay(a: Date, b: Date): boolean {
	return (
		a.getFullYear() === b.getFullYear() &&
		a.getMonth() === b.getMonth() &&
		a.getDate() === b.getDate()
	);
}

/** Zero mail timestamps: time for recent mail, `MMM dd` this month, else `MM/dd/yy`. */
export function formatMailDate(value: string): string {
	const date = validDate(value);
	if (!date) return '';
	const now = new Date();
	const hoursDifference = (now.getTime() - date.getTime()) / 3_600_000;
	if (isSameCalendarDay(date, now) || hoursDifference <= 12) {
		return formatMailTime(value);
	}
	const monthsApart =
		(now.getFullYear() - date.getFullYear()) * 12 + (now.getMonth() - date.getMonth());
	if (monthsApart === 0 || monthsApart === 1) {
		return date.toLocaleDateString([], { month: 'short', day: '2-digit' });
	}
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	const year = String(date.getFullYear()).slice(-2);
	return `${month}/${day}/${year}`;
}

export function formatMailTime(value: string): string {
	const date = validDate(value);
	if (!date) return '';
	return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** Stack a second time line when the primary stamp is a calendar date. */
export function shouldShowSeparateTime(value: string): boolean {
	const date = validDate(value);
	if (!date) return false;
	const now = new Date();
	if (isSameCalendarDay(date, now)) return false;
	const hoursDifference = (now.getTime() - date.getTime()) / 3_600_000;
	return hoursDifference > 12;
}
