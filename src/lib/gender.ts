import { useAuth } from '@/hooks/useAuth';

export type Gender = 'male' | 'female' | 'neutral';

export function useGender(): Gender {
  const { profile } = useAuth();
  const g = (profile as any)?.gender as Gender | undefined;
  return g || 'neutral';
}

/**
 * Pick the right Hebrew variant for the given gender.
 * - male:    masculine address (אתה / בחר / בטוח)
 * - female:  feminine address  (את / בחרי / בטוחה)
 * - neutral: prefer the neutral rewrite if provided, otherwise fall back to male.
 */
export function tg(
  male: string,
  female: string,
  neutral?: string,
  gender: Gender = 'neutral'
): string {
  if (gender === 'female') return female;
  if (gender === 'male') return male;
  return neutral ?? male;
}

export function useTg() {
  const gender = useGender();
  return (male: string, female: string, neutral?: string) => tg(male, female, neutral, gender);
}

export const GENDER_LABELS: Record<Gender, string> = {
  male: 'זכר',
  female: 'נקבה',
  neutral: 'לא מוגדר',
};

/**
 * Map of common masculine UI words/verbs to their feminine counterparts.
 * Only WHOLE word matches are replaced (Hebrew word boundaries).
 */
const FEM_MAP: Record<string, string> = {
  // Pronouns / adjectives
  'אתה': 'את',
  'בטוח': 'בטוחה',
  'תוכל': 'תוכלי',
  'שתוכל': 'שתוכלי',
  'שתעלה': 'שתעלי',
  'שתבחר': 'שתבחרי',
  'שתסמן': 'שתסמני',
  // Imperative singular (m → f)
  'בחר': 'בחרי',
  'בטל': 'בטלי',
  'הזן': 'הזיני',
  'סמן': 'סמני',
  'לחץ': 'לחצי',
  'הקלד': 'הקלידי',
  'הוסף': 'הוסיפי',
  'מחק': 'מחקי',
  'נקה': 'נקי',
  'ערוך': 'ערכי',
  'צור': 'צרי',
  'שמור': 'שמרי',
  'קבל': 'קבלי',
  'הצע': 'הציעי',
  'פתח': 'פתחי',
  'סגור': 'סגרי',
  'גרור': 'גררי',
  'שחרר': 'שחררי',
  'חזור': 'חזרי',
  'העלה': 'העלי',
  'הורד': 'הורידי',
  'חפש': 'חפשי',
  'שלח': 'שלחי',
  'כתוב': 'כתבי',
  'הסר': 'הסירי',
  'הצג': 'הציגי',
  'הסתר': 'הסתירי',
  'שייך': 'שייכי',
  'אשר': 'אשרי',
  'גש': 'גשי',
  'עבור': 'עברי',
  'החזר': 'החזירי',
  'ראה': 'ראי',
  'עדכן': 'עדכני',
  'שנה': 'שני',
  'אישור': 'אישור',
  // Present participle (m → f)
  'מוסיף': 'מוסיפה',
  'מוחק': 'מוחקת',
  'שומר': 'שומרת',
  'טוען': 'טוענת',
  'מעדכן': 'מעדכנת',
  'בוחר': 'בוחרת',
  'יוצר': 'יוצרת',
};

/**
 * Replace whole Hebrew words in `text` with their feminine form (per FEM_MAP).
 * Words are bounded by anything that is not a Hebrew letter.
 */
export function feminize(text: string): string {
  return text.replace(/([א-ת]+)/g, (word) => FEM_MAP[word] ?? word);
}

/**
 * Hook that returns a `g()` function. When the user is female, `g(text)`
 * returns the feminine rewrite of `text`. Otherwise returns it unchanged.
 * Wrap any Hebrew UI string that addresses the user.
 */
export function useG() {
  const gender = useGender();
  return (text: string): string => (gender === 'female' ? feminize(text) : text);
}