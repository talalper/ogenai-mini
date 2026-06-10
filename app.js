import { analyzeWithAI } from "./ai.js";

const STORAGE_KEY = "ogenai-mini-mvp-tasks-v1";

const categories = ["בית", "ילדים", "עבודה", "קניות", "בריאות", "משפחה", "כספים", "אחר"];
const urgencies = ["נמוכה", "בינונית", "גבוהה"];

// 🆕 מילון אימוג'ים חכם לקטגוריות השונות (תומך גם בשמות נקיים וגם בשמות עם אימוג'י קודם)
const categoryIcons = {
  "בית": "🏠", "🏠 בית": "🏠",
  "ילדים": "👧👦", "👧👦 ילדים": "👧👦",
  "עבודה": "💻", "💻 עבודה": "💻",
  "קניות": "🛒", "🛒 קניות": "🛒",
  "בריאות": "🏥", "🏥 בריאות": "🏥",
  "משפחה": "👨‍👩‍👧‍👦", "👨‍👩‍👧‍👦 משפחה": "👨‍👩‍👧‍👦",
  "כספים": "💰", "💰 כספים": "💰",
  "אחר": "📌", "📌 אחר": "📌"
};

const elements = {
 input: document.querySelector("#brainDumpInput"),
 charCounter: document.querySelector("#charCounter"),
 analyzeBtn: document.querySelector("#analyzeBtn"),
 statusBox: document.querySelector("#statusBox"),
 draftSection: document.querySelector("#draftSection"),
 draftList: document.querySelector("#draftList"),
 approveSelectedBtn: document.querySelector("#approveSelectedBtn"),
 clearDraftsBtn: document.querySelector("#clearDraftsBtn"),
 todayTab: document.querySelector("#todayTab"),
 futureTab: document.querySelector("#futureTab"),
 taskSummary: document.querySelector("#taskSummary"),
 taskList: document.querySelector("#taskList"),
 clearAllTasksBtn: document.querySelector("#clearAllTasksBtn")
};

const state = {
 drafts: [],
 tasks: loadTasks(),
 activeTab: "today",
 editingTaskId: null
};

init();

function init() {
 elements.input.addEventListener("input", updateCharCounter);
 elements.analyzeBtn.addEventListener("click", handleAnalyze);
 elements.approveSelectedBtn.addEventListener("click", handleApproveSelected);
 elements.clearDraftsBtn.addEventListener("click", clearDrafts);
 elements.clearAllTasksBtn.addEventListener("click", clearAllTasks);

 elements.draftList.addEventListener("input", handleDraftChange);
 elements.draftList.addEventListener("change", handleDraftChange);
 elements.draftList.addEventListener("click", handleDraftClick);

 elements.todayTab.addEventListener("click", () => setActiveTab("today"));
 elements.futureTab.addEventListener("click", () => setActiveTab("future"));

 elements.taskList.addEventListener("click", handleSavedTaskClick);
 elements.taskList.addEventListener("change", handleSavedTaskChange);

 elements.taskList.addEventListener("click", handleTaskEditActions);

 updateCharCounter();
 renderAll();
}

async function handleAnalyze() {
 const text = elements.input.value.trim();

 if (text.length < 5) {
   showStatus("כתבי לפחות כמה מילים כדי שאוכל לזהות משימות.", "error");
   return;
 }

 if (text.length > 1200) {
   showStatus("הטקסט ארוך מדי. המגבלה היא 1200 תווים.", "error");
   return;
 }

 setLoading(true);
 showStatus("המערכת מסדרת לך את המשימות...", "loading");

 const result = await analyzeWithAI({
   text,
   existingTasks: state.tasks
 });

 setLoading(false);

 if (!result.tasks.length) {
   state.drafts = [];
   renderDrafts();
   showStatus(result.message || "לא זוהתה משימה ברורה. נסחי פעולה לביצוע ונסי שוב.", "error");
   return;
 }

 state.drafts = result.tasks.map((task) => ({
   id: createId(),
   selected: true,
   ...task
 }));

 renderDrafts();

 const sourceText = sourceLabel(result.source);
 const modelText = result.model ? ` • מודל: ${result.model}` : "";
 showStatus(`${result.message || "נוצרו משימות מוצעות."} ${sourceText}${modelText}`, "success");
}

function handleDraftChange(event) {
 const target = event.target;
 const card = target.closest("[data-draft-id]");
 if (!card) return;

 const draft = state.drafts.find((item) => item.id === card.dataset.draftId);
 if (!draft) return;

 if (target.matches("[data-field]")) {
   const field = target.dataset.field;

   if (target.type === "checkbox") {
     draft[field] = target.checked;
   } else if (field === "durationMinutes") {
     draft[field] = normalizeDuration(target.value);
   } else {
     draft[field] = target.value;
   }

   renderDrafts();
 }
}

function handleDraftClick(event) {
 const button = event.target.closest("[data-action]");
 if (!button) return;

 const card = button.closest("[data-draft-id]");
 if (!card) return;

 const draftId = card.dataset.draftId;
 const action = button.dataset.action;

 if (action === "delete-draft") {
   state.drafts = state.drafts.filter((draft) => draft.id !== draftId);
   renderDrafts();
   showStatus("הטיוטה נמחקה ולא תישמר.", "success");
 }
}

function handleApproveSelected() {
 const selectedDrafts = state.drafts.filter((draft) => draft.selected);

 if (!selectedDrafts.length) {
   showStatus("לא סומנה אף משימה לאישור.", "error");
   return;
 }

 const approvedTasks = selectedDrafts
   .filter((draft) => cleanText(draft.title).length > 0)
   .map((draft) => ({
     id: createId(),
     title: cleanText(draft.title),
     category: categories.includes(draft.category) ? draft.category : "אחר",
     executionDate: draft.executionDate || isoToday(),
     dueDate: draft.dueDate || addDaysIso(isoToday(), 7),
     time: draft.time || "",
     durationMinutes: normalizeDuration(draft.durationMinutes),
     urgency: urgencies.includes(draft.urgency) ? draft.urgency : "בינונית",
     notes: draft.notes || "",
     isDuplicate: Boolean(draft.isDuplicate),
     status: "open",
     createdAt: new Date().toISOString()
   }));

 if (!approvedTasks.length) {
   showStatus("אי אפשר לשמור משימה ללא תיאור פעולה.", "error");
   return;
 }

 state.tasks = [...approvedTasks, ...state.tasks];
 state.drafts = [];
 saveTasks();
 elements.input.value = "";
 updateCharCounter();
 renderAll();
 showStatus(`נשמרו ${approvedTasks.length} משימות מאושרות.`, "success");
}

function clearDrafts() {
 state.drafts = [];
 renderDrafts();
 showStatus("טיוטות ה־AI נוקו.", "success");
}

function clearAllTasks() {
 const confirmed = window.confirm("האם לאפס את כל משימות הדמו מהדפדפן?");
 if (!confirmed) return;

 state.tasks = [];
 state.drafts = [];
 saveTasks();
 renderAll();
 showStatus("כל נתוני הדמו נמחקו מהדפדפן.", "success");
}

function handleSavedTaskChange(event) {
 const checkbox = event.target.closest("[data-complete-task]");
 if (!checkbox) return;

 const taskId = checkbox.dataset.completeTask;
 const task = state.tasks.find((item) => item.id === taskId);
 if (!task) return;

 task.status = checkbox.checked ? "completed" : "open";
 task.completedAt = checkbox.checked ? new Date().toISOString() : "";
 saveTasks();
 renderTasks();
}

function handleSavedTaskClick(event) {
 const button = event.target.closest("[data-delete-task]");
 if (!button) return;

 const taskId = button.dataset.deleteTask;
 state.tasks = state.tasks.filter((task) => task.id !== taskId);
 saveTasks();
 renderTasks();
 showStatus("המשימה נמחקה.", "success");
}

// 🆕 --- פונקציות עריכת משימה קיימת ---

function handleTaskEditActions(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;

  const card = button.closest("[data-task-id]");
  if (!card) return;

  const taskId = card.dataset.taskId;
  const action = button.dataset.action;

  // לחיצה על כפתור העיפרון כדי להיכנס למצב עריכה
  if (action === "edit-task") {
    state.editingTaskId = taskId;
    renderTasks();
  }

  // לחיצה על ביטול בטופס העריכה
  if (action === "cancel-edit") {
    state.editingTaskId = null;
    renderTasks();
  }

  // לחיצה על שמירה בטופס העריכה
  if (action === "save-edit") {
    const task = state.tasks.find((t) => t.id === taskId);
    if (!task) return;

    // אוסף את הנתונים החדשים מהטופס
    const newTitle = card.querySelector('[data-edit-field="title"]').value;
    const newCategory = card.querySelector('[data-edit-field="category"]').value;
    const newUrgency = card.querySelector('[data-edit-field="urgency"]').value;
    const newExecutionDate = card.querySelector('[data-edit-field="executionDate"]').value;
    const newDueDate = card.querySelector('[data-edit-field="dueDate"]').value;
    const newTime = card.querySelector('[data-edit-field="time"]').value;
    const newDuration = card.querySelector('[data-edit-field="durationMinutes"]').value;

    if (cleanText(newTitle).length === 0) {
      showStatus("המשימה חייבת לכלול תיאור", "error");
      return;
    }

    // מעדכן את האובייקט
    task.title = cleanText(newTitle);
    task.category = newCategory;
    task.urgency = newUrgency;
    task.executionDate = newExecutionDate || isoToday();
    task.dueDate = newDueDate || isoToday();
    task.time = newTime;
    task.durationMinutes = normalizeDuration(newDuration);
    
    state.editingTaskId = null; // יוצא ממצב עריכה
    saveTasks();
    renderTasks();
    showStatus("המשימה עודכנה בהצלחה.", "success");
  }
}

function setActiveTab(tab) {
 state.activeTab = tab;
 elements.todayTab.classList.toggle("active", tab === "today");
 elements.futureTab.classList.toggle("active", tab === "future");
 renderTasks();
}

function renderAll() {
 renderDrafts();
 renderTasks();
}

function renderDrafts() {
 elements.draftSection.classList.toggle("hidden", state.drafts.length === 0);

 if (!state.drafts.length) {
   elements.draftList.innerHTML = "";
   return;
 }

 elements.draftList.innerHTML = state.drafts.map((draft) => renderDraftCard(draft)).join("");
}

function renderDraftCard(draft) {
 return `
   <article class="card" data-draft-id="${escapeHtml(draft.id)}">
     <div class="card-header">
       <div>
         <div class="card-title">טיוטת משימה</div>
         <div class="meta-line">ערכי ברירת מחדל ניתנים לעריכה לפני אישור.</div>
       </div>
       <div class="card-actions">
         <label class="badge green">
           <input type="checkbox" data-field="selected" ${draft.selected ? "checked" : ""} />
           לאישור
         </label>
         <button class="icon-btn delete" type="button" data-action="delete-draft" aria-label="מחיקת טיוטה">🗑</button>
       </div>
     </div>

     <div class="form-grid">
       <label class="title-input">
         משימה
         <input data-field="title" type="text" value="${escapeAttribute(draft.title)}" />
       </label>

       <label>
         קטגוריה
         <select data-field="category">
           ${categories.map((category) => option(category, draft.category)).join("")}
         </select>
       </label>

       <label>
         דחיפות
         <select data-field="urgency">
           ${urgencies.map((urgency) => option(urgency, draft.urgency)).join("")}
         </select>
       </label>

       <label>
         תאריך ביצוע
         <input data-field="executionDate" type="date" value="${escapeAttribute(draft.executionDate)}" />
       </label>

       <label>
         תאריך יעד
         <input data-field="dueDate" type="date" value="${escapeAttribute(draft.dueDate)}" />
       </label>

       <label>
         שעה
         <input data-field="time" type="time" value="${escapeAttribute(draft.time)}" />
       </label>

       <label>
         משך בדקות
         <input data-field="durationMinutes" type="number" min="10" max="300" step="5" value="${escapeAttribute(String(draft.durationMinutes))}" />
       </label>
     </div>

     <div class="badges">
       ${draft.isDuplicate ? `<span class="badge pink">ייתכן שכפול</span>` : ""}
       ${draft.notes ? `<span class="badge">${escapeHtml(draft.notes)}</span>` : ""}
     </div>
   </article>
 `;
}

function renderTasks() {
 const today = isoToday();

 const visibleTasks = state.tasks.filter((task) => {
   if (state.activeTab === "today") {
     return task.executionDate <= today;
   }

   return task.executionDate > today;
 });

 const urgencyWeights = {
    "גבוהה": 3,
    "בינונית": 2,
    "נמוכה": 1
  };

  visibleTasks.sort((a, b) => {
    // 1. סטטוס ביצוע: משימות שבוצעו יורדות לתחתית
    const aCompleted = a.status === "completed";
    const bCompleted = b.status === "completed";

    if (aCompleted && !bCompleted) return 1;
    if (!aCompleted && bCompleted) return -1;

    // 2. דחיפות: משימות דחופות יותר עולות למעלה
    const weightA = urgencyWeights[a.urgency] || 0;
    const weightB = urgencyWeights[b.urgency] || 0;
    
    if (weightA !== weightB) {
      return weightB - weightA;
    }

    // 3. שובר שוויון - שעה: אם הדחיפות זהה, נמיין לפי שעת הביצוע
    const timeA = a.time || "";
    const timeB = b.time || "";

    // אם למשימה א' יש שעה ולמשימה ב' אין - א' תקדים
    if (timeA && !timeB) return -1;
    // אם למשימה ב' יש שעה ולמשימה א' אין - ב' תקדים
    if (!timeA && timeB) return 1;
    
    // אם לשתיהן יש שעה, נסדר אותן כרונולוגית מהבוקר לערב
    if (timeA && timeB) {
      return timeA.localeCompare(timeB);
    }

    return 0; // אם לשתיהן אין שעה מוגדרת, הן יישארו באותו סדר
  });

 const openCount = visibleTasks.filter((task) => task.status !== "completed").length; 
 const doneCount = visibleTasks.filter((task) => task.status === "completed").length;

 elements.taskSummary.innerHTML =
  state.activeTab === "today"
    ? `<span>להיום: ${visibleTasks.length} משימות</span> <span class="dot">•</span> <span>פתוחות: ${openCount}</span> <span class="dot">•</span> <span>בוצעו: ${doneCount}</span>`
    : `<span>עתידיות: ${visibleTasks.length} משימות</span>`;

 if (!visibleTasks.length) {
   elements.taskList.innerHTML = `
     <div class="empty-state">
       ${state.activeTab === "today"
         ? "אין עדיין משימות להיום. כתבי משהו בתיבה למעלה והפעילי את ה־AI."
         : "אין כרגע משימות עתידיות."}
     </div>
   `;
   return;
 }

 elements.taskList.innerHTML = visibleTasks
   .map((task) => renderSavedTaskCard(task))
   .join("");
}

function renderSavedTaskCard(task) {
  // 🆕 אם המשימה הזו נמצאת כרגע במצב עריכה, נרנדר את תבנית הטופס
  if (state.editingTaskId === task.id) {
    return renderEditTaskForm(task);
  }

  const completed = task.status === "completed";
  const categoryClass = completed ? "green" : "";
  const urgencyClass = task.urgency === "גבוהה" ? "high-urgency" : ""; 

  const icon = categoryIcons[task.category] || "📌";
  const cleanCategoryName = task.category.replace(/[\u2300-\u23fa\u2600-\u27bf\ud83c-\ud83e][\ud000-\udfff]?\s*/g, "");

  return `
    <article class="card task-view-card ${completed ? "completed" : ""}" data-task-id="${escapeHtml(task.id)}">
      <input
        class="task-checkbox"
        type="checkbox"
        data-complete-task="${escapeHtml(task.id)}"
        ${completed ? "checked" : ""}
        aria-label="סימון משימה כבוצעה"
      />

      <div>
        <div>
        <div class="card-title">${escapeHtml(task.title)}</div>
        
        <div class="task-details-chips">
          ${task.time ? `<span class="info-chip">🕒 ${escapeHtml(task.time)}</span>` : ""}
          <span class="info-chip">⏱ ${escapeHtml(task.durationMinutes)} דק׳</span>
          <span class="info-chip ${urgencyClass}">דחיפות: ${escapeHtml(task.urgency)}</span>
          <span class="info-chip">${icon} ${escapeHtml(cleanCategoryName)}</span>
        </div>

        <div class="task-details-chips" style="margin-top: 8px;">
          <span class="info-chip date-chip ${categoryClass}">ביצוע: ${formatDate(task.executionDate)}</span>
          <span class="info-chip date-chip">יעד: ${formatDate(task.dueDate)}</span>
          ${task.isDuplicate ? `<span class="badge pink">ייתכן שכפול</span>` : ""}
        </div>
      </div>
      </div>

      <div class="card-actions-column">
        <button class="icon-btn edit" type="button" data-action="edit-task" aria-label="עריכת משימה">✎</button>
        <button class="icon-btn delete" type="button" data-delete-task="${escapeHtml(task.id)}" aria-label="מחיקת משימה">🗑</button>
      </div>
    </article>
  `;
}


// 🆕 פונקציה חדשה שמייצרת את הטופס כשהכרטיס במצב עריכה
function renderEditTaskForm(task) {
  return `
    <article class="card" data-task-id="${escapeHtml(task.id)}" style="border: 2px solid var(--purple);">
      <div class="card-header">
        <div class="card-title">עריכת משימה</div>
      </div>

      <div class="form-grid">
        <label class="title-input">
          משימה
          <input data-edit-field="title" type="text" value="${escapeAttribute(task.title)}" />
        </label>

        <label>
          קטגוריה
          <select data-edit-field="category">
            ${categories.map((c) => option(c, task.category)).join("")}
          </select>
        </label>

        <label>
          דחיפות
          <select data-edit-field="urgency">
            ${urgencies.map((u) => option(u, task.urgency)).join("")}
          </select>
        </label>

        <label>
          תאריך ביצוע
          <input data-edit-field="executionDate" type="date" value="${escapeAttribute(task.executionDate)}" />
        </label>

        <label>
          תאריך יעד
          <input data-edit-field="dueDate" type="date" value="${escapeAttribute(task.dueDate)}" />
        </label>

        <label>
          שעה
          <input data-edit-field="time" type="time" value="${escapeAttribute(task.time)}" />
        </label>

        <label>
          משך בדקות
          <input data-edit-field="durationMinutes" type="number" min="10" max="300" step="5" value="${escapeAttribute(String(task.durationMinutes))}" />
        </label>
      </div>

      <div class="input-footer" style="margin-top: 16px;">
        <button class="ghost-btn" type="button" data-action="cancel-edit">ביטול</button>
        <button class="primary-btn" type="button" data-action="save-edit">שמור שינויים</button>
      </div>
    </article>
  `;
}

function option(value, selectedValue) {
 // שולף את האימוג'י המתאים מתוך המילון הקיים בתחילת הקובץ
 const icon = categoryIcons[value] || "";
 
 return `
   <option value="${escapeAttribute(value)}" ${value === selectedValue ? "selected" : ""}>
     ${icon} ${escapeHtml(value)}
   </option>
 `;
}

function showStatus(message, type = "success") {
 elements.statusBox.textContent = message;
 elements.statusBox.className = "status-box";

 if (type === "error") elements.statusBox.classList.add("error");
 if (type === "loading") elements.statusBox.classList.add("loading");

 elements.statusBox.classList.remove("hidden");
}

function setLoading(isLoading) {
 elements.analyzeBtn.disabled = isLoading;
 elements.analyzeBtn.textContent = isLoading ? "מסדרת..." : "צור לי משימות";
}

function updateCharCounter() {
 elements.charCounter.textContent = `${elements.input.value.length}/1200`;
}

function sourceLabel(source) {
 if (source === "openai") return "• עובד עם OpenAI API";
 if (source === "backend-fallback-no-api-key") return "• מצב גיבוי: אין API Key";
 if (source === "backend-fallback-api-error") return "• מצב גיבוי: תקלה זמנית ב־API";
 if (source === "frontend-fallback") return "• מצב גיבוי מקומי";
 return "";
}

function loadTasks() {
 try {
   const raw = localStorage.getItem(STORAGE_KEY);
   const parsed = JSON.parse(raw || "[]");
   return Array.isArray(parsed) ? parsed : [];
 } catch {
   return [];
 }
}

function saveTasks() {
 localStorage.setItem(STORAGE_KEY, JSON.stringify(state.tasks));
}

function createId() {
 if (crypto && typeof crypto.randomUUID === "function") {
   return crypto.randomUUID();
 }

 return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeDuration(value) {
 const number = Number(value);
 if (!Number.isFinite(number)) return 60;
 return Math.min(Math.max(Math.round(number), 10), 300);
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

function formatDate(isoDate) {
 if (!isoDate) return "";
 return new Intl.DateTimeFormat("he-IL", {
   day: "2-digit",
   month: "2-digit",
   year: "2-digit"
 }).format(new Date(`${isoDate}T12:00:00`));
}

function escapeHtml(value) {
 return String(value || "")
   .replaceAll("&", "&amp;")
   .replaceAll("<", "&lt;")
   .replaceAll(">", "&gt;")
   .replaceAll('"', "&quot;")
   .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
 return escapeHtml(value);
}