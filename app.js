// app.js — 할 일 관리 앱: 데이터 / 렌더링 / 이벤트 / 초기화 (Supabase 연동)

// ---------- Supabase 설정 ----------

const SUPABASE_URL = "https://yvaxcrvbfksbnpgnnafx.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl2YXhjcnZiZmtzYm5wZ25uYWZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk1MTUyMzQsImV4cCI6MjA5NTA5MTIzNH0.yyvq2gW_EnJRgvz8BVTwcfnWjIAQqKFVhidsFWARTDE";

const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---------- 상수 & 상태 ----------

const CATEGORY_LABELS = {
    work: "업무",
    personal: "개인",
    study: "공부",
};

const VALID_CATEGORIES = ["work", "personal", "study"];

const CATEGORY_KEYWORDS = {
    work: [
        "회의", "미팅", "보고서", "보고", "이메일", "메일", "발표", "프로젝트",
        "클라이언트", "고객", "업무", "출장", "결재", "기획", "마감", "회사",
        "팀", "거래처", "계약",
    ],
    study: [
        "공부", "강의", "수업", "시험", "과제", "숙제", "학습", "독서", "책",
        "영어", "수학", "국어", "인강", "복습", "예습", "학원", "자격증",
        "토익", "토플", "코딩", "논문",
    ],
    personal: [
        "운동", "헬스", "요가", "산책", "조깅", "쇼핑", "장보기", "약속", "친구",
        "가족", "영화", "여행", "식사", "점심", "저녁", "아침", "병원", "청소",
        "빨래", "은행", "미용실",
    ],
};

const CATEGORY_KEYWORDS_LOWER = Object.fromEntries(
    Object.entries(CATEGORY_KEYWORDS).map(([cat, kws]) => [
        cat,
        kws.map((kw) => kw.toLowerCase()),
    ])
);

const AUTO_FALLBACK_CATEGORY = "personal";
const AUTO_HINT_DEBOUNCE_MS = 150;

let currentFilter = "all";
let todos = [];

let todoListEl;
let todoInputEl;
let categorySelectEl;
let addButtonEl;
let progressBarEl;
let progressBarFillEl;
let progressTextEl;
let filterButtonEls;
let autoHintEl;

let autoHintTimer = null;

// ---------- 자동 카테고리 분류 ----------

function classifyByKeywords(text) {
    if (!text) return AUTO_FALLBACK_CATEGORY;
    const lower = text.toLowerCase();
    let best = AUTO_FALLBACK_CATEGORY;
    let bestScore = 0;
    for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS_LOWER)) {
        let score = 0;
        for (const kw of keywords) {
            if (lower.includes(kw)) score++;
        }
        if (score > bestScore) {
            bestScore = score;
            best = category;
        }
    }
    return best;
}

function resolveCategory(selectValue, text) {
    return selectValue === "auto" ? classifyByKeywords(text) : selectValue;
}

// ---------- 데이터 계층 (Supabase) ----------

async function loadTodos() {
    const { data, error } = await db
        .from("todo")
        .select("*")
        .order("created_at", { ascending: false });
    if (error) {
        console.error("loadTodos 오류:", error);
        return [];
    }
    return data;
}

async function addTodo(text, category) {
    const { data, error } = await db
        .from("todo")
        .insert({ text, category, completed: false })
        .select()
        .single();
    if (error) {
        console.error("addTodo 오류:", error);
        return null;
    }
    todos.unshift(data);
    return data;
}

async function updateTodo(id, newText, newCategory) {
    const { data, error } = await db
        .from("todo")
        .update({ text: newText, category: newCategory })
        .eq("id", id)
        .select()
        .single();
    if (error) {
        console.error("updateTodo 오류:", error);
        return null;
    }
    const idx = todos.findIndex((t) => t.id === id);
    if (idx !== -1) todos[idx] = data;
    return data;
}

async function deleteTodo(id) {
    const { error } = await db.from("todo").delete().eq("id", id);
    if (error) {
        console.error("deleteTodo 오류:", error);
        return;
    }
    const idx = todos.findIndex((t) => t.id === id);
    if (idx !== -1) todos.splice(idx, 1);
}

async function toggleTodo(id) {
    const todo = todos.find((t) => t.id === id);
    if (!todo) return null;
    const { data, error } = await db
        .from("todo")
        .update({ completed: !todo.completed })
        .eq("id", id)
        .select()
        .single();
    if (error) {
        console.error("toggleTodo 오류:", error);
        return null;
    }
    const idx = todos.findIndex((t) => t.id === id);
    if (idx !== -1) todos[idx] = data;
    return data;
}

// ---------- 렌더링 ----------

function renderTodos() {
    const visible = currentFilter === "all"
        ? todos.slice()
        : todos.filter((t) => t.category === currentFilter);

    visible.sort((a, b) => a.completed - b.completed);

    todoListEl.innerHTML = "";

    if (visible.length === 0) {
        const empty = document.createElement("li");
        empty.className = "empty-state";
        empty.textContent = todos.length === 0
            ? "✅ 아직 할 일이 없어요. 위에서 추가해보세요!"
            : "🔍 이 카테고리에 해당하는 항목이 없어요.";
        todoListEl.appendChild(empty);
    } else {
        const frag = document.createDocumentFragment();
        for (const todo of visible) {
            frag.appendChild(buildTodoItem(todo));
        }
        todoListEl.appendChild(frag);
    }

    updateProgress();
}

function buildTodoItem(todo) {
    const li = document.createElement("li");
    li.className = "todo-item";
    li.dataset.id = todo.id;

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = todo.completed;
    checkbox.addEventListener("change", async () => {
        await toggleTodo(todo.id);
        renderTodos();
    });

    const categoryEl = document.createElement("span");
    categoryEl.className = `category-label category-${todo.category}`;
    categoryEl.textContent = CATEGORY_LABELS[todo.category] ?? todo.category;

    const textEl = document.createElement("span");
    textEl.className = "todo-text";
    if (todo.completed) textEl.classList.add("completed");
    textEl.textContent = todo.text;

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "edit-button";
    editBtn.textContent = "수정";
    editBtn.addEventListener("click", () => startEdit(li, todo));

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "delete-button";
    deleteBtn.textContent = "삭제";
    deleteBtn.addEventListener("click", async () => {
        if (!window.confirm("삭제하시겠습니까?")) return;
        await deleteTodo(todo.id);
        renderTodos();
    });

    li.append(checkbox, categoryEl, textEl, editBtn, deleteBtn);
    return li;
}

function updateProgress() {
    const total = todos.length;
    const done = todos.reduce((acc, t) => acc + (t.completed ? 1 : 0), 0);
    const percent = total === 0 ? 0 : Math.round((done / total) * 100);
    progressBarFillEl.style.width = percent + "%";
    progressTextEl.textContent = `${done} / ${total} 완료 (${percent}%)`;
    if (progressBarEl) {
        progressBarEl.setAttribute("aria-valuenow", String(percent));
    }
    const completed = total > 0 && done === total;
    progressBarFillEl.classList.toggle("is-complete", completed);
    progressTextEl.classList.toggle("is-complete", completed);
}

function setFilter(filter) {
    currentFilter = filter;
    for (const btn of filterButtonEls) {
        btn.classList.toggle("active", btn.dataset.filter === filter);
    }
    renderTodos();
}

// ---------- 이벤트 핸들러 ----------

async function handleAdd() {
    const text = todoInputEl.value.trim();
    if (!text) return;
    const category = resolveCategory(categorySelectEl.value, text);
    await addTodo(text, category);
    todoInputEl.value = "";
    updateAutoHint();
    renderTodos();
}

function computeAutoHint() {
    if (!autoHintEl) return;
    if (categorySelectEl.value !== "auto") {
        autoHintEl.hidden = true;
        return;
    }
    const text = todoInputEl.value.trim();
    if (!text) {
        autoHintEl.hidden = true;
        return;
    }
    const category = classifyByKeywords(text);
    autoHintEl.hidden = false;
    autoHintEl.textContent = `자동 분류: ${CATEGORY_LABELS[category]}`;
}

function updateAutoHint() {
    if (autoHintTimer !== null) clearTimeout(autoHintTimer);
    autoHintTimer = setTimeout(() => {
        autoHintTimer = null;
        computeAutoHint();
    }, AUTO_HINT_DEBOUNCE_MS);
}

function startEdit(li, todo) {
    li.innerHTML = "";
    li.classList.add("editing");

    const input = document.createElement("input");
    input.type = "text";
    input.className = "edit-input";
    input.value = todo.text;

    const select = document.createElement("select");
    select.className = "edit-category";
    const autoOpt = document.createElement("option");
    autoOpt.value = "auto";
    autoOpt.textContent = "자동";
    select.appendChild(autoOpt);
    for (const [value, label] of Object.entries(CATEGORY_LABELS)) {
        const opt = document.createElement("option");
        opt.value = value;
        opt.textContent = label;
        if (value === todo.category) opt.selected = true;
        select.appendChild(opt);
    }

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.textContent = "저장";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.textContent = "취소";

    const commit = async () => {
        const newText = input.value.trim();
        if (!newText) return;
        const newCategory = resolveCategory(select.value, newText);
        await updateTodo(todo.id, newText, newCategory);
        renderTodos();
    };

    const cancel = () => renderTodos();

    const onKeydown = (e) => {
        if (e.key === "Enter") commit();
        else if (e.key === "Escape") cancel();
    };

    saveBtn.addEventListener("click", commit);
    cancelBtn.addEventListener("click", cancel);
    input.addEventListener("keydown", onKeydown);
    select.addEventListener("keydown", onKeydown);

    li.append(input, select, saveBtn, cancelBtn);
    input.focus();
    input.select();
}

// ---------- 초기화 ----------

document.addEventListener("DOMContentLoaded", async () => {
    todoListEl = document.getElementById("todo-list");
    todoInputEl = document.getElementById("todo-input");
    categorySelectEl = document.getElementById("category-select");
    addButtonEl = document.getElementById("add-button");
    progressBarEl = document.querySelector(".progress-bar");
    progressBarFillEl = document.getElementById("progress-bar-fill");
    progressTextEl = document.getElementById("progress-text");
    filterButtonEls = document.querySelectorAll(".filter-button");
    autoHintEl = document.getElementById("auto-hint");

    todos = await loadTodos();

    addButtonEl.addEventListener("click", handleAdd);
    todoInputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") handleAdd();
    });
    todoInputEl.addEventListener("input", updateAutoHint);
    categorySelectEl.addEventListener("change", updateAutoHint);
    computeAutoHint();

    for (const btn of filterButtonEls) {
        btn.addEventListener("click", () => setFilter(btn.dataset.filter));
    }

    setFilter(currentFilter);
});
