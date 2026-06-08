import OpenAI from "openai";

// תיקון שם המודל לגרסה הקיימת והמהירה של OpenAI
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

const CATEGORIES = [
  "בית",
  "ילדים",
  "עבודה",
  "קניות",
  "בריאות",
  "משפחה",
  "כספים",
  "אחר"
];

const ACTION_WORDS = [
  "ללכת", "לעשות", "לבקש",
  "לקנות", "להתקשר", "לשלוח", "לקחת", "להחזיר", "לאסוף", "לקבוע",
  "לתאם", "לבדוק", "לשלם", "להכין", "לבשל", "לנקות", "לסדר",
  "לכבס", "להביא", "להוציא", "להזמין", "לכתוב", "לקרוא", "להגיש",
  "לעדכן", "צריך", "צריכה", "חייבת", "לא לשכוח", "תור", "קניות",
  "מייל", "גן", "בית ספר"
];

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8"
};

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return jsonResponse(200, { ok: true });
  }

  if (event.httpMethod !== "POST") {
    return jsonResponse(405, {
      ok: false,
      error: "Only POST requests are supported."
    });
  }

  let body;

  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return jsonResponse(400, {
      ok: false,
      error: "Invalid JSON body."
    });
  }

  const text = cleanText(body.text);
  const existingTasks = Array.isArray(body.existingTasks) ? body.existingTasks : [];

  if (text.length < 5) {
    return jsonResponse(400, {
      ok: false,
      error: "Text is too short."
    });
  }

  if (text.length > 1200) {
    return jsonResponse(400, {
      ok: false,
      error: "Text is too long. Maximum length is 1200 characters."
    });
  }

  if (!process.env.OPENAI_API_KEY) {
    const fallbackTasks = buildLocalFallbackTasks(text, existingTasks);

    return jsonResponse(200, {
      ok: true,
      source: "backend-fallback-no-api-key",
      model: null,
      message: fallbackTasks.length
        ? "לא הוגדר OPENAI_API_KEY. נוצרו משימות בסיסיות במצב גיבוי."
        : "לא הוגדר OPENAI_API_KEY ולא זוהתה משימה ברורה במצב גיבוי.",
      tasks: fallbackTasks
    });
  }

  try {
    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });

    const today = isoToday();
    const defaultDueDate = addDaysIso(today, 7);
    const prompt = buildPrompt({
      text,
      today,
      defaultDueDate,
      existingTasks
    });

    const response = await client.responses.create({
      model: MODEL,
      temperature: 0.1, // הורדנו קצת יצירתיות כדי שיצמד לחוקים
      input: [
        {
          role: "system",
          content:
            "You are an expert Hebrew task-extraction engine. You return only valid JSON. You never add explanations outside JSON."
        },
        {
          role: "user",
          content: prompt
        }
      ]
    });

    const rawOutput = response.output_text || "";
    const parsed = parseJsonFromModel(rawOutput);
    const normalizedTasks = normalizeTasks(parsed.tasks || [], existingTasks, today, defaultDueDate);

    return jsonResponse(200, {
      ok: true,
      source: "openai",
      model: MODEL,
      message: normalizedTasks.length
        ? "ה־AI חילץ משימות מוצעות לעריכה ואישור."
        : "לא זוהתה משימה ברורה. נסחי פעולה לביצוע ונסי שוב.",
      tasks: normalizedTasks
    });
  } catch (error) {
    const fallbackTasks = buildLocalFallbackTasks(text, existingTasks);

    return jsonResponse(200, {
      ok: true,
      source: "backend-fallback-api-error",
      model: MODEL,
      message: fallbackTasks.length
        ? "הייתה תקלה זמנית בקריאת ה־OpenAI API. נוצרו משימות בסיסיות במצב גיבוי."
        : "הייתה תקלה זמנית בקריאת ה־OpenAI API ולא זוהתה משימה ברורה במצב גיבוי.",
      error: error.message,
      tasks: fallbackTasks
    });
  }
};

function buildPrompt({ text, today, defaultDueDate, existingTasks }) {
  const existingTasksText = existingTasks.length
    ? existingTasks
        .slice(0, 40)
        .map((task, index) => {
          const title = task.title || task.taskTitle || "";
          const date = task.executionDate || "";
          const category = task.category || "";
          return `${index + 1}. ${title} | ${date} | ${category}`;
        })
        .join("\n")
    : "אין משימות קיימות.";

  return `
אתה רכיב AI בתוך אפליקציית OgenAI לניהול עומס מנטלי ומשימות יומיומיות.

המטרה:
לקבל מלל חופשי בעברית ולהחזיר רשימת משימות נפרדות, קצרות וברורות לביצוע.

הקלט של המשתמשת:
"""
${text}
"""

תאריך היום:
${today}

תאריך יעד ברירת מחדל:
${defaultDueDate}

קטגוריות אפשריות:
${CATEGORIES.join(", ")}

משימות קיימות לזיהוי כפילויות:
${existingTasksText}

חובה לפעול לפי החוקים הבאים:

1. החזר רק JSON תקין.
2. אל תחזיר הסבר לפני או אחרי ה-JSON.
3. אל תמציא משימות שלא מופיעות בטקסט.

חוקי פיצול חשובים מאוד:
4. חובה להפריד משימות מחוברות: אם מופיעה מילת חיבור (כמו "ו" החיבור, "וגם", "אז") לפני פעולה נוספת, חובה עליך ליצור משימות נפרדות. אל תאחד פעולות שונות למשימה אחת בשום אופן!
5. פעלים כמו: לקנות, לקחת, לשלוח, לקבוע, לכבס, לנקות, להתקשר, לבדוק, לשלם, להכין, להביא, לאסוף, לתאם, לכתוב, להזמין, ללכת, לעשות, לבקש - לרוב מייצגים משימה נפרדת.
6. רק אם פעולה אחת כוללת כמה פריטים מאותו סוג, אל תפצל (למשל "לקנות חלב ולחם").

חוקי שדות ושעות:
7. זיהוי שעות חכם: אם מופיעה שעה בטקסט (גם במילים או כמספר בודד, כמו "ב 4", "בשעה ארבע"), חלץ אותה והמר אותה לפורמט HH:MM בשעון 24 שעות והכנס לשדה time. 
8. אם השעה קטנה מ-8 (למשל "ב 4"), הנח שמדובר באחר הצהריים והחזר תמיד בפורמט עשרים וארבע שעות (למשל 16:00).
9. category חייבת להיות אחת מהקטגוריות המותרות.

דוגמאות חובה ללמידה - פעל בדיוק כך:

קלט: "לקנות בלונים ולעשות עוגה"
פלט רצוי (שים לב לפיצול ו' החיבור):
{
  "tasks": [
    {
      "title": "לקנות בלונים",
      "category": "קניות",
      "executionDate": "${today}",
      "dueDate": "${defaultDueDate}",
      "time": "",
      "durationMinutes": 60,
      "urgency": "בינונית",
      "notes": "",
      "isDuplicate": false
    },
    {
      "title": "לעשות עוגה",
      "category": "בית",
      "executionDate": "${today}",
      "dueDate": "${defaultDueDate}",
      "time": "",
      "durationMinutes": 60,
      "urgency": "בינונית",
      "notes": "",
      "isDuplicate": false
    }
  ]
}

קלט: "ללכת לקניות ולהוציא את הילדים מהגן ב 4"
פלט רצוי (שים לב לחילוץ השעה "ב 4" והמרתה ל-16:00, ולפיצול):
{
  "tasks": [
    {
      "title": "ללכת לקניות",
      "category": "קניות",
      "executionDate": "${today}",
      "dueDate": "${defaultDueDate}",
      "time": "",
      "durationMinutes": 60,
      "urgency": "בינונית",
      "notes": "",
      "isDuplicate": false
    },
    {
      "title": "להוציא את הילדים מהגן",
      "category": "ילדים",
      "executionDate": "${today}",
      "dueDate": "${defaultDueDate}",
      "time": "16:00",
      "durationMinutes": 60,
      "urgency": "בינונית",
      "notes": "",
      "isDuplicate": false
    }
  ]
}

מבנה JSON חובה להחזרה (עקוב בדיוק אחרי תבנית זו):
{
  "tasks": [
    {
      "title": "string",
      "category": "בית | ילדים | עבודה | קניות | בריאות | משפחה | כספים | אחר",
      "executionDate": "YYYY-MM-DD",
      "dueDate": "YYYY-MM-DD",
      "time": "HH:MM or empty string",
      "durationMinutes": 60,
      "urgency": "נמוכה | בינונית | גבוהה",
      "notes": "string",
      "isDuplicate": false
    }
  ]
}
`.trim();
}

function parseJsonFromModel(rawOutput) {
  const cleaned = String(rawOutput || "")
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");

    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
    }

    return { tasks: [] };
  }
}

function normalizeTasks(tasks, existingTasks, today, defaultDueDate) {
  if (!Array.isArray(tasks)) return [];

  return tasks
    .slice(0, 10)
    .map((task) => {
      const title = cleanText(task.title || task.taskTitle || "");

      return {
        title,
        category: CATEGORIES.includes(task.category) ? task.category : "אחר",
        executionDate: isIsoDate(task.executionDate) ? task.executionDate : today,
        dueDate: isIsoDate(task.dueDate) ? task.dueDate : defaultDueDate,
        time: isTime(task.time) ? task.time : "",
        durationMinutes: normalizeDuration(task.durationMinutes),
        urgency: ["נמוכה", "בינונית", "גבוהה"].includes(task.urgency) ? task.urgency : "בינונית",
        notes: cleanText(task.notes || ""),
        isDuplicate: Boolean(task.isDuplicate) || existingTasks.some((existing) => isSimilar(title, existing.title || ""))
      };
    })
    .filter((task) => task.title.length > 1);
}

function buildLocalFallbackTasks(text, existingTasks = []) {
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
      notes: "נוצר במצב גיבוי שרת.",
      isDuplicate
    });
  }

  return tasks;
}

function splitIntoSegments(text) {
  let processedText = String(text || "").replace(/\r/g, "\n");
  const actionWordsPattern = ACTION_WORDS.join('|');
  
  const regexVav = new RegExp(`(^|\\s)(ו)(${actionWordsPattern})(?=\\s|$)`, 'g');
  processedText = processedText.replace(regexVav, '$1. $3');

  const regexWords = new RegExp(`(^|\\s)(וגם|אז)\\s+(${actionWordsPattern})(?=\\s|$)`, 'g');
  processedText = processedText.replace(regexWords, '$1. $3');

  return processedText
    .split(/[\n.;!?]+|(?:,\s*)|(?:\s+-\s+)/)
    .map((item) => cleanText(item))
    .filter((item) => item.length > 1);
}

function looksLikeTask(segment) {
  const lower = segment.toLowerCase();
  return ACTION_WORDS.some((word) => lower.includes(word));
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
  const exactMatch = segment.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (exactMatch) return `${exactMatch[1].padStart(2, "0")}:${exactMatch[2]}`;

  const textTimeMatch = segment.match(/(?:^|\s)(בשעה|ב|ב-|לשעה)\s*([0-9]{1,2}|אחת|שתיים|שלוש|ארבע|חמש|שש|שבע|שמונה|תשע|עשר|אחת עשרה|שתים עשרה)(?=\s|$|[.,])/);

  if (textTimeMatch) {
    let hourStr = textTimeMatch[2];
    let hour = parseInt(hourStr);

    if (isNaN(hour)) {
      const hebrewHours = {
        "אחת": 1, "שתיים": 2, "שלוש": 3, "ארבע": 4, "חמש": 5,
        "שש": 6, "שבע": 7, "שמונה": 8, "תשע": 9, "עשר": 10,
        "אחת עשרה": 11, "שתים עשרה": 12
      };
      hour = hebrewHours[hourStr];
    }

    if (hour >= 1 && hour <= 7) {
      hour += 12;
    }

    if (hour >= 0 && hour <= 23) {
      return `${String(hour).padStart(2, "0")}:00`;
    }
  }

  return "";
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

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(body)
  };
}