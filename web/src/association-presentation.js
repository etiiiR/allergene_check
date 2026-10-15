// Keep small personal samples descriptive. A percentage from one or two diary
// moments looks more certain than the underlying observation warrants.
export const MIN_COMPARISON_MOMENTS = 5;

export function associationPresentation(association) {
  const showRates =
    Number(association?.exposed) >= MIN_COMPARISON_MOMENTS &&
    Number(association?.unexposed) >= MIN_COMPARISON_MOMENTS;

  if (!showRates) {
    return {
      showRates: false,
      label: "Noch wenig Daten",
      tone: "neutral",
      exposedRate: "Zu wenige Daten",
      unexposedRate:
        association?.rate_unexposed == null
          ? "Keine Vergleichsmomente"
          : "Zu wenige Daten",
    };
  }

  if (
    association?.difference == null ||
    !Number.isFinite(Number(association.difference))
  ) {
    return {
      showRates: false,
      label: "Noch wenig Daten",
      tone: "neutral",
      exposedRate: "Zu wenige Daten",
      unexposedRate: "Zu wenige Daten",
    };
  }

  const difference = Number(association.difference);
  const label =
    difference >= 0.25
      ? "Häufiger in deinen Einträgen"
      : difference <= -0.25
        ? "Seltener in deinen Einträgen"
        : "Ähnlich in deinen Einträgen";

  return {
    showRates: true,
    label,
    tone: difference >= 0.25 ? "high" : "neutral",
    exposedRate: formatRate(association.rate_exposed),
    unexposedRate: formatRate(association.rate_unexposed),
  };
}

function formatRate(rate) {
  return rate != null && Number.isFinite(Number(rate))
    ? `${Math.round(Number(rate) * 100)} %`
    : "–";
}
