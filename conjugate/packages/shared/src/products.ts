import { z } from 'zod';

/** The 31 ADCdb workbook rows the research chat may scope. Identity only: a row here is not clinical evidence. */
export const WORKBOOK_PRODUCT_IDS = ['DRG0CYMEB', 'DRG0ERKBH', 'DRG0EKTUN', 'DRG0ZOYQV', 'DRG0JWBNH', 'DRG0JOHND', 'DRG0SXFSY', 'DRG0BBQSE', 'DRG0QWZIT', 'DRG0TKVCB', 'DRG0PNJIT', 'DRG0JEVIM', 'DRG0GKOZH', 'DRG0NDXRU', 'DRG0COMTY', 'DRG0RIPVI', 'DRG0PZSXJ', 'DRG0CECRA', 'DRG0BSQPI', 'DRG0IFWXM', 'DRG0WCTHL', 'DRG0ULCEQ', 'DRG0PXQWR', 'DRG0WXQJL', 'DRG0ELYWP', 'DRG0EPHMC', 'DRG0OZSZX', 'DRG0IRZIB', 'DRG0SDZSF', 'DRG0JBKMD', 'DRG0FUFBP'] as const;
export const WorkbookProductIdSchema = z.enum(WORKBOOK_PRODUCT_IDS);
export type WorkbookProductId = z.infer<typeof WorkbookProductIdSchema>;
/** Only these products have local UK label paraphrases (pending pharmacist review). */
export const LABEL_PRODUCT_IDS = ['DRG0CYMEB', 'DRG0ERKBH'] as const;
export type LabelProductId = typeof LABEL_PRODUCT_IDS[number];

export interface WorkbookProduct { id: WorkbookProductId; name: string; brand: string | null; target: string; aliases: readonly string[]; us_label?: { openfda: string; dailymed: string } }
/** us_label holds exact openFDA brand_name.exact strings checked against api.fda.gov on 2026-10-04; rows without one get no openFDA/DailyMed lookup. */
export const WORKBOOK_PRODUCTS: readonly WorkbookProduct[] = [
  {id: 'DRG0CYMEB', name: 'Trastuzumab emtansine', brand: 'Kadcyla', target: 'Receptor tyrosine-protein kinase erbB-2 (HER2)', aliases: ['T-DM1','TDM1','ado-trastuzumab emtansine'], us_label: {openfda: 'KADCYLA', dailymed: 'KADCYLA'}},
  {id: 'DRG0ERKBH', name: 'Trastuzumab deruxtecan', brand: 'Enhertu', target: 'Receptor tyrosine-protein kinase erbB-2 (HER2)', aliases: ['T-DXd','TDXd','fam-trastuzumab deruxtecan','fam-trastuzumab deruxtecan-nxki'], us_label: {openfda: 'Enhertu', dailymed: 'Enhertu'}},
  {id: 'DRG0EKTUN', name: 'Sacituzumab govitecan', brand: 'Trodelvy', target: 'Tumor-associated calcium signal transducer 2 (TACSTD2)', aliases: [], us_label: {openfda: 'TRODELVY', dailymed: 'TRODELVY'}},
  {id: 'DRG0ZOYQV', name: 'Datopotamab deruxtecan', brand: 'Datroway', target: 'Tumor-associated calcium signal transducer 2 (TACSTD2)', aliases: ['Dato-DXd'], us_label: {openfda: 'DATROWAY', dailymed: 'DATROWAY'}},
  {id: 'DRG0JWBNH', name: 'Brentuximab vedotin', brand: 'Adcetris', target: 'Tumor necrosis factor receptor superfamily member 8 (TNFRSF8)', aliases: [], us_label: {openfda: 'ADCETRIS', dailymed: 'ADCETRIS'}},
  {id: 'DRG0JOHND', name: 'Gemtuzumab ozogamicin', brand: 'Mylotarg', target: 'Myeloid cell surface antigen CD33 (CD33)', aliases: [], us_label: {openfda: 'Mylotarg', dailymed: 'MYLOTARG'}},
  {id: 'DRG0SXFSY', name: 'Inotuzumab ozogamicin', brand: 'Besponsa', target: 'B-cell receptor CD22 (CD22)', aliases: [], us_label: {openfda: 'Besponsa', dailymed: 'BESPONSA'}},
  {id: 'DRG0BBQSE', name: 'Enfortumab vedotin', brand: 'Padcev', target: 'Nectin-4 (NECTIN4)', aliases: [], us_label: {openfda: 'PADCEV EJFV', dailymed: 'PADCEV'}},
  {id: 'DRG0QWZIT', name: 'Polatuzumab vedotin', brand: 'Polivy', target: 'B-cell antigen receptor complex-associated protein beta chain (CD79B)', aliases: [], us_label: {openfda: 'POLIVY', dailymed: 'POLIVY'}},
  {id: 'DRG0TKVCB', name: 'Loncastuximab tesirine', brand: 'Zynlonta', target: 'B-lymphocyte antigen CD19 (CD19)', aliases: [], us_label: {openfda: 'ZYNLONTA', dailymed: 'ZYNLONTA'}},
  {id: 'DRG0PNJIT', name: 'Tisotumab vedotin', brand: 'Tivdak', target: 'Tissue factor (F3)', aliases: [], us_label: {openfda: 'TIVDAK', dailymed: 'TIVDAK'}},
  {id: 'DRG0JEVIM', name: 'Disitamab vedotin', brand: 'Aidixi', target: 'Receptor tyrosine-protein kinase erbB-2 (HER2)', aliases: []},
  {id: 'DRG0GKOZH', name: 'Mirvetuximab soravtansine', brand: 'Elahere', target: 'Folate receptor alpha (FOLR1)', aliases: [], us_label: {openfda: 'ELAHERE', dailymed: 'ELAHERE'}},
  {id: 'DRG0NDXRU', name: 'Belantamab mafodotin', brand: 'Blenrep', target: 'Tumor necrosis factor receptor superfamily member 17 (TNFRSF17)', aliases: [], us_label: {openfda: 'Blenrep', dailymed: 'BLENREP'}},
  {id: 'DRG0COMTY', name: 'Telisotuzumab vedotin', brand: null, target: 'Hepatocyte growth factor receptor (MET)', aliases: []},
  {id: 'DRG0RIPVI', name: 'Becotatug vedotin', brand: null, target: 'Epidermal growth factor receptor (EGFR)', aliases: []},
  {id: 'DRG0PZSXJ', name: 'Trastuzumab botidotin', brand: null, target: 'Receptor tyrosine-protein kinase erbB-2 (HER2)', aliases: []},
  {id: 'DRG0CECRA', name: 'Trastuzumab rezetecan', brand: null, target: 'Receptor tyrosine-protein kinase erbB-2 (HER2)', aliases: []},
  {id: 'DRG0BSQPI', name: 'Sacituzumab tirumotecan', brand: null, target: 'Tumor-associated calcium signal transducer 2 (TACSTD2)', aliases: []},
  {id: 'DRG0IFWXM', name: 'izalontamab brengitecan', brand: null, target: 'Epidermal growth factor receptor (EGFR); Receptor tyrosine-protein kinase erbB-3 (HER3)', aliases: []},
  {id: 'DRG0WCTHL', name: 'Pivekimab sunirine', brand: null, target: 'Interleukin-3 receptor subunit alpha (IL3RA)', aliases: []},
  {id: 'DRG0ULCEQ', name: 'Rovalpituzumab tesirine', brand: null, target: 'Delta-like protein 3 (DLL3)', aliases: []},
  {id: 'DRG0PXQWR', name: 'Depatuxizumab mafodotin', brand: null, target: 'Epidermal growth factor receptor (EGFR)', aliases: []},
  {id: 'DRG0WXQJL', name: 'Vadastuximab talirine', brand: null, target: 'Myeloid cell surface antigen CD33 (CD33)', aliases: []},
  {id: 'DRG0ELYWP', name: 'Tusamitamab ravtansine', brand: null, target: 'Carcinoembryonic antigen-related cell adhesion molecule 5 (CEACAM5)', aliases: []},
  {id: 'DRG0EPHMC', name: 'Anetumab ravtansine', brand: null, target: 'Mesothelin (MSLN)', aliases: []},
  {id: 'DRG0OZSZX', name: 'Upifitamab rilsodotin', brand: null, target: 'Sodium-dependent phosphate transport protein 2B (SLC34A2)', aliases: []},
  {id: 'DRG0IRZIB', name: 'Glembatumumab vedotin', brand: null, target: 'Transmembrane glycoprotein NMB (GPNMB)', aliases: []},
  {id: 'DRG0SDZSF', name: 'Lorvotuzumab mertansine', brand: null, target: 'Neural cell adhesion molecule 1 (NCAM1)', aliases: []},
  {id: 'DRG0JBKMD', name: 'Labetuzumab govitecan', brand: null, target: 'Carcinoembryonic antigen-related cell adhesion molecule 5 (CEACAM5)', aliases: []},
  {id: 'DRG0FUFBP', name: 'Camidanlumab tesirine', brand: null, target: 'Interleukin-2 receptor subunit alpha (IL2RA)', aliases: []}
];

const BY_ID = new Map<string, WorkbookProduct>(WORKBOOK_PRODUCTS.map(product => [product.id, product]));
export function workbookProduct(id: string): WorkbookProduct | undefined { return BY_ID.get(id); }
export function isWorkbookProductId(id: string): id is WorkbookProductId { return BY_ID.has(id); }
export function isLabelProduct(id: string): id is LabelProductId { return (LABEL_PRODUCT_IDS as readonly string[]).includes(id); }
/** Brand when the workbook has one, otherwise the INN, e.g. "Kadcyla" or "Telisotuzumab vedotin". */
export function productLabel(id: string): string { const product = BY_ID.get(id); return product ? product.brand ?? product.name : id; }
export function liveProductSources(id: string): ('openfda' | 'dailymed' | 'adcdb')[] { return BY_ID.get(id)?.us_label ? ['openfda', 'dailymed', 'adcdb'] : ['adcdb']; }
/** Lower-case phrases that name a product, longest first so "datopotamab deruxtecan" wins over the Enhertu shorthand "deruxtecan". */
export const PRODUCT_PHRASES: readonly { phrase: string; id: WorkbookProductId }[] = [
  ...WORKBOOK_PRODUCTS.flatMap(product => [product.name, product.brand ?? '', product.id, ...product.aliases].filter(Boolean).map(phrase => ({ phrase: phrase.toLowerCase(), id: product.id }))),
  ...(['emtansine', 'tdm1', 't-dm1'] as const).map(phrase => ({ phrase, id: 'DRG0CYMEB' as const })),
  ...(['deruxtecan', 'tdxd', 't-dxd'] as const).map(phrase => ({ phrase, id: 'DRG0ERKBH' as const }))
].filter((item, index, all) => all.findIndex(other => other.phrase === item.phrase) === index).sort((a, b) => b.phrase.length - a.phrase.length);
