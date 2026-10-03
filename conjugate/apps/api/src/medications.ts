export type KnownMedicine = 'clarithromycin' | 'itraconazole' | 'ritonavir' | 'warfarin' | 'apixaban' | 'rivaroxaban' | 'aspirin' | 'clopidogrel';

// Whole normalized aliases only: no substring/stem matching or guessed doses.
const aliases = new Map<string, KnownMedicine>([
  ['clarithromycin', 'clarithromycin'], ['klacid', 'clarithromycin'],
  ['itraconazole', 'itraconazole'], ['sporanox', 'itraconazole'],
  ['ritonavir', 'ritonavir'], ['norvir', 'ritonavir'],
  ['warfarin', 'warfarin'], ['coumadin', 'warfarin'],
  ['apixaban', 'apixaban'], ['eliquis', 'apixaban'],
  ['rivaroxaban', 'rivaroxaban'], ['xarelto', 'rivaroxaban'],
  ['aspirin', 'aspirin'], ['acetylsalicylic acid', 'aspirin'],
  ['clopidogrel', 'clopidogrel'], ['plavix', 'clopidogrel']
]);
export function matchMedicine(value: string): KnownMedicine | undefined {
  return aliases.get(value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' '));
}
export function medicationContext(values: readonly string[]) {
  const matched = values.map(matchMedicine);
  const known = new Set(matched.filter((item): item is KnownMedicine => item !== undefined));
  return {
    unknown_count: matched.filter(item => item === undefined).length,
    has_cyp3a4_example: ['clarithromycin', 'itraconazole', 'ritonavir'].some(item => known.has(item as KnownMedicine)),
    has_studied_enhertu_inhibitor: known.has('itraconazole') || known.has('ritonavir'),
    has_antithrombotic_example: ['warfarin', 'apixaban', 'rivaroxaban', 'aspirin', 'clopidogrel'].some(item => known.has(item as KnownMedicine)),
    known_count: known.size
  };
}
