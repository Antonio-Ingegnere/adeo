import { t } from './i18n/index.js';

const splitRrule = (rule: string) =>
  rule.split(';').reduce<Record<string, string>>((acc, part) => {
    const [key, value] = part.split('=');
    if (key && value) acc[key] = value;
    return acc;
  }, {});

const toOrdinalLabel = (value: string) => {
  switch (value) {
    case '1':
      return t('repeat.ordinal.first');
    case '2':
      return t('repeat.ordinal.second');
    case '3':
      return t('repeat.ordinal.third');
    case '4':
      return t('repeat.ordinal.fourth');
    case '-1':
      return t('repeat.ordinal.last');
    default:
      return t('repeat.ordinal.first');
  }
};

const toWeekdayLabel = (value: string) => {
  const keyMap: Record<string, string> = {
    MO: 'weekday.mon',
    TU: 'weekday.tue',
    WE: 'weekday.wed',
    TH: 'weekday.thu',
    FR: 'weekday.fri',
    SA: 'weekday.sat',
    SU: 'weekday.sun',
  };
  const key = keyMap[value];
  return key ? t(key as any) : value;
};

const toMonthLabel = (value: string) => {
  const keyMap: Record<string, string> = {
    '1': 'month.january',
    '2': 'month.february',
    '3': 'month.march',
    '4': 'month.april',
    '5': 'month.may',
    '6': 'month.june',
    '7': 'month.july',
    '8': 'month.august',
    '9': 'month.september',
    '10': 'month.october',
    '11': 'month.november',
    '12': 'month.december',
  };
  const key = keyMap[value];
  return key ? t(key as any) : value;
};

export const repeatSummaryFromRule = (rule: string) => {
  const parts = splitRrule(rule);
  const freq = parts.FREQ ?? '';
  const interval = parts.INTERVAL ?? '1';
  if (freq === 'DAILY') {
    if (interval === '1') {
      return t('repeat.summary.everyDay');
    }
    return t('repeat.summary.everyNDays').replace('{n}', interval);
  }
  if (freq === 'WEEKLY') {
    const byday = parts.BYDAY ? parts.BYDAY.split(',') : [];
    if (byday.join(',') === 'MO,TU,WE,TH,FR') {
      return t('repeat.summary.everyWeekday');
    }
    const dayLabels = byday.map(toWeekdayLabel);
    const weekPart = interval === '1'
      ? t('repeat.summary.everyWeek')
      : t('repeat.summary.everyNWeeks').replace('{n}', interval);
    if (dayLabels.length) {
      return t('repeat.summary.onDays')
        .replace('{base}', weekPart)
        .replace('{days}', dayLabels.join(', '));
    }
    return weekPart;
  }
  if (freq === 'MONTHLY') {
    const monthPart = interval === '1'
      ? t('repeat.summary.everyMonth')
      : t('repeat.summary.everyNMonths').replace('{n}', interval);
    if (parts.BYMONTHDAY) {
      return t('repeat.summary.onDayNum')
        .replace('{base}', monthPart)
        .replace('{n}', parts.BYMONTHDAY);
    }
    if (parts.BYDAY && parts.BYSETPOS) {
      const ordinal = toOrdinalLabel(parts.BYSETPOS);
      if (parts.BYDAY === 'MO,TU,WE,TH,FR') {
        return t('repeat.summary.onOrdinalWeekdayAny')
          .replace('{base}', monthPart)
          .replace('{ordinal}', ordinal);
      }
      if (parts.BYDAY === 'SA,SU') {
        return t('repeat.summary.onOrdinalWeekendDay')
          .replace('{base}', monthPart)
          .replace('{ordinal}', ordinal);
      }
      return t('repeat.summary.onOrdinalWeekday')
        .replace('{base}', monthPart)
        .replace('{ordinal}', ordinal)
        .replace('{weekday}', toWeekdayLabel(parts.BYDAY));
    }
    return monthPart;
  }
  if (freq === 'YEARLY') {
    if (parts.BYMONTH) {
      const monthLabel = toMonthLabel(parts.BYMONTH);
      if (parts.BYMONTHDAY) {
        const yearlyBase = t('repeat.summary.everyYearIn').replace('{month}', monthLabel);
        return t('repeat.summary.onDayNum')
          .replace('{base}', yearlyBase)
          .replace('{n}', parts.BYMONTHDAY);
      }
      if (parts.BYDAY && parts.BYSETPOS) {
        const ordinal = toOrdinalLabel(parts.BYSETPOS);
        const yearlyPart = t('repeat.summary.everyYearIn').replace('{month}', monthLabel);
        if (parts.BYDAY === 'MO,TU,WE,TH,FR') {
          return t('repeat.summary.onOrdinalWeekdayAny')
            .replace('{base}', yearlyPart)
            .replace('{ordinal}', ordinal);
        }
        if (parts.BYDAY === 'SA,SU') {
          return t('repeat.summary.onOrdinalWeekendDay')
            .replace('{base}', yearlyPart)
            .replace('{ordinal}', ordinal);
        }
        return t('repeat.summary.onOrdinalWeekday')
          .replace('{base}', yearlyPart)
          .replace('{ordinal}', ordinal)
          .replace('{weekday}', toWeekdayLabel(parts.BYDAY));
      }
      return t('repeat.summary.everyYearIn').replace('{month}', monthLabel);
    }
    // Yearly with no BYMONTH: use everyYear (equivalent to "Every month" for consistency)
    return t('repeat.summary.everyYear');
  }
  return t('repeat.summary.repeats');
};
