const FALLBACK_CATEGORIES = [
 "בית",
 "ילדים",
 "עבודה",
 "קניות",
 "בריאות",
 "משפחה",
 "כספים",
 "אחר"
];

export async function analyzeWithAI({ text, existingTasks = [] }) {
 const payload = {
   text,
   existingTasks: existingTasks.slice(0, 40).map((task) => ({
     title: task.title,
     executionDate: task.executionDate,
     category: task.category
   }))
 };

 try {
   const response = await fetch("/.netlify/functions/ai", {
     method: "POST",
     headers: {
       "Content-Type": "application/json"
     },
     body: JSON.stringify(payload)
   });

   const data = await response.json().catch(() => null);

   if (!response.ok || !data) {
     throw new Error(data?.error || "AI request failed");
   }

   return normalizeAnalyzeResponse(data);
 } catch (error) {
   return {
     ok: true,
     source: "frontend-fallback",
     message: "החיבור ל־AI לא הצליח. הופעלה גרסת גיבוי בסיסית כדי שהאפליקציה תמשיך לעבוד.",
     tasks: buildLocalFallbackTasks(text, existingTasks),
     error: error.message
   };
 }
}

function normalizeAnalyzeResponse(data) {
 const tasks = Array.isArray(data.tasks) ? data.tasks : [];

 return {
   ok: Boolean(data.ok),
   source: data.source || "unknown",
   model: data.model || null,
   message: data.message || "הניתוח הסתיים.",
   tasks: tasks.map((task) => normalizeTask(task)),
   error: data.error || null
 };
}

function normalizeTask(task) {
 const today = isoToday();
 const defaultDueDate = addDaysIso(today, 7);

 return {
   title: cleanText(task.title || task.taskTitle || "משימה ללא כותרת"),
   category: FALLBACK_CATEGORIES.includes(task.category) ? task.category : "אחר",
   executionDate: isIsoDate(task.executionDate) ? task.executionDate : today,
   dueDate: isIsoDate(task.dueDate) ? task.dueDate : defaultDueDate,
   time: isTime(task.time) ? task.time : "",
   durationMinutes: normalizeDuration(task.durationMinutes),
   urgency: ["נמוכה", "בינונית", "גבוהה"].includes(task.urgency) ? task.urgency : "בינונית",
   notes: cleanText(task.notes || ""),
   isDuplicate: Boolean(task.isDuplicate)
 };
}

export function buildLocalFallbackTasks(text, existingTasks = []) {
 const segments = splitIntoSegments(text);
 const tasks = [];

 for (const segment of segments) {
   if (tasks.length >= 8) break;
   if (!looksLikeTask(segment)) continue;

   const title = createTaskTitle(segment);
   if (!title || title.length < 2) continue;

   const category = detectCategory(segment);
   const executionDate = detectExecutionDate(segment);
   const dueDate = addDaysIso(isoToday(), 7);
   const time = detectTime(segment);
   const durationMinutes = detectDuration(segment);
   const urgency = detectUrgency(segment);
   const isDuplicate = existingTasks.some((task) => isSimilar(title, task.title || ""));

   tasks.push({
     title,
     category,
     executionDate,
     dueDate,
     time,
     durationMinutes,
     urgency,
     notes: "נוצר במצב גיבוי ללא OpenAI API.",
     isDuplicate
   });
 }

 return tasks;
}

function splitIntoSegments(text) {
 return String(text || "")
   .replace(/\r/g, "\n")
   .split(/[\n.;!?]+|(?:,\s*)|(?:\s+-\s+)/)
   .map((item) => cleanText(item))
   .filter((item) => item.length > 1);
}

function looksLikeTask(segment) {
 const actionWords = [
   "לקנות",
   "להתקשר",
   "לשלוח",
   "לקחת",
   "להחזיר",
   "לאסוף",
   "לקבוע",
   "לתאם",
   "לבדוק",
   "לשלם",
   "להכין",
   "לבשל",
   "לנקות",
   "לסדר",
   "לכבס",
   "להביא",
   "להוציא",
   "להזמין",
   "לכתוב",
   "לקרוא",
   "להגיש",
   "לעדכן",
   "צריך",
   "צריכה",
   "חייבת",
   "לא לשכוח",
   "תור",
   "קניות",
   "מייל",
   "גן",
   "בית ספר"
 ];

 const lower = segment.toLowerCase();
 return actionWords.some((word) => lower.includes(word));
}

function createTaskTitle(segment) {
 return cleanText(segment)
   .replace(/^(אני\s+)?(צריכה|צריך|חייבת|חייב|לא לשכוח|תזכורת|וגם|גם)\s+/i, "")
   .replace(/^שצריך\s+/i, "")
   .trim();
}

function detectCategory(segment) {
 const value = segment.toLowerCase();

 if (/(ילדים|ילד|ילדה|גן|בית ספר|חוג|מטפלת|בייביסיטר)/.test(value)) return "ילדים";
 if (/(מייל|עבודה|מנהלת|לקוח|פגישה|מצגת|דוח|דו״ח|משרד)/.test(value)) return "עבודה";
 if (/(לקנות|קניות|סופר|חלב|לחם|ירקות|פארם)/.test(value)) return "קניות";
 if (/(רופא|רופאה|תור|תרופה|בריאות|בדיקה|מרפאה)/.test(value)) return "בריאות";
 if (/(בנק|חשבון|לשלם|תשלום|כסף|ביטוח|חשבונית)/.test(value)) return "כספים";
 if (/(אמא|אבא|משפחה|סבתא|סבא|אחות|אח)/.test(value)) return "משפחה";
 if (/(כביסה|לכבס|לנקות|בית|כלים|סידור|לסדר|בישול|לבשל)/.test(value)) return "בית";

 return "אחר";
}

function detectUrgency(segment) {
 const value = segment.toLowerCase();

 if (/(דחוף|היום|עד הערב|חשוב מאוד|מיד|עכשיו)/.test(value)) return "גבוהה";
 if (/(לא דחוף|מתי שאפשר|בהמשך|שבוע הבא)/.test(value)) return "נמוכה";

 return "בינונית";
}

function detectTime(segment) {
 const match = segment.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
 if (!match) return "";
 return `${match[1].padStart(2, "0")}:${match[2]}`;
}

function detectDuration(segment) {
 const value = segment.toLowerCase();

 const minutesMatch = value.match(/(\d{1,3})\s*(דקות|דק׳|דק)/);
 if (minutesMatch) return clampNumber(Number(minutesMatch[1]), 10, 240);

 const hoursMatch = value.match(/(\d{1,2})\s*(שעות|שעה)/);
 if (hoursMatch) return clampNumber(Number(hoursMatch[1]) * 60, 15, 300);

 if (value.includes("חצי שעה")) return 30;
 if (value.includes("שעתיים")) return 120;
 if (value.includes("שעה")) return 60;

 return 60;
}

function detectExecutionDate(segment) {
 const today = isoToday();
 const value = segment.toLowerCase();

 if (value.includes("מחר")) return addDaysIso(today, 1);
 if (value.includes("מחרתיים")) return addDaysIso(today, 2);
 if (value.includes("שבוע הבא")) return addDaysIso(today, 7);

 return today;
}

function isSimilar(a, b) {
 const first = normalizeForCompare(a);
 const second = normalizeForCompare(b);

 if (!first || !second) return false;
 return first.includes(second) || second.includes(first);
}

function normalizeForCompare(value) {
 return String(value || "")
   .toLowerCase()
   .replace(/[^\u0590-\u05ff a-z0-9]/gi, "")
   .replace(/\s+/g, " ")
   .trim();
}

function normalizeDuration(value) {
 const number = Number(value);
 if (!Number.isFinite(number)) return 60;
 return clampNumber(Math.round(number), 10, 300);
}

function clampNumber(value, min, max) {
 return Math.min(Math.max(value, min), max);
}

function cleanText(value) {
 return String(value || "")
   .replace(/\s+/g, " ")
   .trim();
}

function isoToday() {
 const date = new Date();
 date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
 return date.toISOString().slice(0, 10);
}

function addDaysIso(isoDate, days) {
 const date = new Date(`${isoDate}T12:00:00`);
 date.setDate(date.getDate() + days);
 date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
 return date.toISOString().slice(0, 10);
}

function isIsoDate(value) {
 return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function isTime(value) {
 return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ""));
}
