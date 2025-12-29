const splitRrule = (rule: string) =>
  rule.split(';').reduce<Record<string, string>>((acc, part) => {
    const [key, value] = part.split('=');
    if (key && value) acc[key] = value;
    return acc;
  }, {});

const toOrdinalLabel = (value: string) => {
  switch (value) {
    case '1':
      return 'First';
    case '2':
      return 'Second';
    case '3':
      return 'Third';
    case '4':
      return 'Fourth';
    case '-1':
      return 'Last';
    default:
      return 'First';
  }
};

const toWeekdayLabel = (value: string) => {
  const map: Record<string, string> = {
    MO: 'Monday',
    TU: 'Tuesday',
    WE: 'Wednesday',
    TH: 'Thursday',
    FR: 'Friday',
    SA: 'Saturday',
    SU: 'Sunday',
  };
  return map[value] ?? value;
};

const toMonthLabel = (value: string) => {
  const map: Record<string, string> = {
    '1': 'January',
    '2': 'February',
    '3': 'March',
    '4': 'April',
    '5': 'May',
    '6': 'June',
    '7': 'July',
    '8': 'August',
    '9': 'September',
    '10': 'October',
    '11': 'November',
    '12': 'December',
  };
  return map[value] ?? value;
};

export const repeatSummaryFromRule = (rule: string) => {
  const parts = splitRrule(rule);
  const freq = parts.FREQ ?? '';
  const interval = parts.INTERVAL ?? '1';
  if (freq === 'DAILY') {
    return interval === '1' ? 'Every day' : `Every ${interval} days`;
  }
  if (freq === 'WEEKLY') {
    const byday = parts.BYDAY ? parts.BYDAY.split(',') : [];
    if (byday.join(',') === 'MO,TU,WE,TH,FR') return 'Every weekday';
    const dayLabels = byday.map(toWeekdayLabel);
    const weekPart = interval === '1' ? 'Every week' : `Every ${interval} weeks`;
    return dayLabels.length ? `${weekPart} on ${dayLabels.join(', ')}` : weekPart;
  }
  if (freq === 'MONTHLY') {
    const monthPart = interval === '1' ? 'Every month' : `Every ${interval} months`;
    if (parts.BYMONTHDAY) {
      return `${monthPart} on day ${parts.BYMONTHDAY}`;
    }
    if (parts.BYDAY && parts.BYSETPOS) {
      const ordinal = toOrdinalLabel(parts.BYSETPOS);
      if (parts.BYDAY === 'MO,TU,WE,TH,FR') {
        return `${monthPart} on ${ordinal} Weekday`;
      }
      if (parts.BYDAY === 'SA,SU') {
        return `${monthPart} on ${ordinal} Weekend Day`;
      }
      return `${monthPart} on ${ordinal} ${toWeekdayLabel(parts.BYDAY)}`;
    }
    return monthPart;
  }
  if (freq === 'YEARLY') {
    const monthLabel = parts.BYMONTH ? toMonthLabel(parts.BYMONTH) : 'month';
    if (parts.BYMONTHDAY) {
      return `Every ${monthLabel} on day ${parts.BYMONTHDAY}`;
    }
    if (parts.BYDAY && parts.BYSETPOS) {
      const ordinal = toOrdinalLabel(parts.BYSETPOS);
      if (parts.BYDAY === 'MO,TU,WE,TH,FR') {
        return `Every ${monthLabel} on ${ordinal} Weekday`;
      }
      if (parts.BYDAY === 'SA,SU') {
        return `Every ${monthLabel} on ${ordinal} Weekend Day`;
      }
      return `Every ${monthLabel} on ${ordinal} ${toWeekdayLabel(parts.BYDAY)}`;
    }
    return `Every ${monthLabel}`;
  }
  return 'Repeats';
};
