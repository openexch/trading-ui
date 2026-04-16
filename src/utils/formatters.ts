export function formatPrice(price: number | undefined | null): string {
  const val = price ?? 0;
  // Use appropriate precision based on price magnitude
  let decimals = 2;
  if (val > 0 && val < 1) decimals = 6;
  else if (val >= 1 && val < 10) decimals = 4;
  return val.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatQuantity(quantity: number | undefined | null): string {
  const val = quantity ?? 0;
  if (val >= 1) {
    return val.toLocaleString('en-US', {
      minimumFractionDigits: 4,
      maximumFractionDigits: 4,
    });
  }
  return val.toLocaleString('en-US', {
    minimumFractionDigits: 8,
    maximumFractionDigits: 8,
  });
}

export function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }) + '.' + String(date.getMilliseconds()).padStart(3, '0');
}
