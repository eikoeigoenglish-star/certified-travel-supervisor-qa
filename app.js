// =======================
// 設定
// =======================
const CHOICE_KEYS = [1, 2, 3, 4];
const CHOICE_MARKERS = ["①", "②", "③", "④"];
const STORAGE_KEY = "domestic-travel-progress-v1";

// 習得段階。streak（連続正解数）から決まる。
// 未出題 = 記録なし / ミス = 0 / ヒット = 1 / ダブル = 2 / トリプル = 3
const STAGES = [
  { key: "triple", label: "トリプル", streak: 3 },
  { key: "double", label: "ダブル", streak: 2 },
  { key: "hit", label: "ヒット", streak: 1 },
  { key: "miss", label: "ミス", streak: 0 },
  { key: "new", label: "未出題", streak: null }
];

const MAX_STREAK = 3;

// =======================
// 状態
// =======================
const state = {
  allQuestions: [],
  questions: [],
  answers: {},
  currentIndex: 0,
  progress: {}
};

// =======================
// 進捗の保存と読み込み
// =======================
function loadProgress() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};

    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    console.warn("進捗を読み込めませんでした", error);
    return {};
  }
}

function saveProgress() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.progress));
  } catch (error) {
    console.warn("進捗を保存できませんでした", error);
    showStorageWarning();
  }
}

function showStorageWarning() {
  const note = document.getElementById("mastery-note");
  if (note) {
    note.textContent = "この環境では進捗を保存できません。閉じるとリセットされます。";
  }
}

function stageOf(questionId) {
  const streak = state.progress[questionId];

  if (streak === undefined) return "new";
  if (streak >= MAX_STREAK) return "triple";
  if (streak === 2) return "double";
  if (streak === 1) return "hit";
  return "miss";
}

function stageLabel(key) {
  return STAGES.find(stage => stage.key === key)?.label ?? "";
}

// =======================
// 初期化
// =======================
async function init() {
  try {
    const response = await fetch("data/questions.json");

    if (!response.ok) {
      throw new Error(`questions.json の読込に失敗しました（HTTP ${response.status}）`);
    }

    const questions = await response.json();

    if (!Array.isArray(questions)) {
      throw new Error("questions.json の形式が配列ではありません。");
    }

    validateQuestions(questions);

    state.allQuestions = questions;
    state.progress = loadProgress();

    renderFilterControls();
    renderMastery();
    updateAvailableCounts();

    document.getElementById("start-btn").addEventListener("click", startExam);
    document.getElementById("next-btn").addEventListener("click", nextQuestion);
    document.getElementById("back-to-start-btn").addEventListener("click", backToStart);
    document.getElementById("category-toggle-btn").addEventListener("click", toggleAllCategories);
    document.getElementById("reset-progress-btn").addEventListener("click", resetProgress);
    document.addEventListener("keydown", handleQuizKeydown);
  } catch (error) {
    showStartError(error.message || "問題データを読み込めませんでした。");
    document.getElementById("start-btn").disabled = true;
    console.error(error);
  }
}

window.addEventListener("DOMContentLoaded", init);

function validateQuestions(questions) {
  questions.forEach((question, index) => {
    if (!question?.id) {
      throw new Error(`questions.json の ${index + 1} 件目に id がありません。`);
    }

    if (!Number.isFinite(Number(question.year))) {
      throw new Error(`${question.id}: year が不正です。`);
    }

    if (!Number.isFinite(Number(question.questionNumber))) {
      throw new Error(`${question.id}: questionNumber が不正です。`);
    }

    if (!Array.isArray(question.choices) || question.choices.length !== 4) {
      throw new Error(`${question.id}: choices は4個必要です。`);
    }

    if (!Array.isArray(question.correct) || question.correct.length === 0) {
      throw new Error(`${question.id}: correct がありません。`);
    }
  });
}

// =======================
// 年度・科目フィルター生成
// =======================
function renderFilterControls() {
  const years = [...new Set(state.allQuestions.map(question => Number(question.year)))]
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  const categories = [...new Set(state.allQuestions.map(question => String(question.category ?? "").trim()))]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "ja"));

  const yearArea = document.getElementById("year-options");
  yearArea.innerHTML = "";

  yearArea.appendChild(
    createFilterChip({
      type: "radio",
      name: "year",
      value: "all",
      id: "year-all",
      label: `全部（${years.length}年分）`,
      checked: true,
      wide: true
    })
  );

  years.forEach(year => {
    yearArea.appendChild(
      createFilterChip({
        type: "radio",
        name: "year",
        value: String(year),
        id: `year-${year}`,
        label: `${year}年度`
      })
    );
  });

  const categoryArea = document.getElementById("category-options");
  categoryArea.innerHTML = "";

  categories.forEach((category, index) => {
    categoryArea.appendChild(
      createFilterChip({
        type: "checkbox",
        name: "category",
        value: category,
        id: `category-${index + 1}`,
        label: category,
        checked: true,
        wide: true
      })
    );
  });

  document.getElementById("total-question-count").textContent = String(state.allQuestions.length);
  updateCategoryToggleLabel();
}

function createFilterChip({ type, name, value, id, label, checked = false, wide = false }) {
  const fragment = document.createDocumentFragment();

  const input = document.createElement("input");
  input.type = type;
  input.name = name;
  input.value = value;
  input.id = id;
  input.checked = checked;

  const chip = document.createElement("label");
  chip.className = `chip${wide ? " chip-wide" : ""}`;
  chip.htmlFor = id;
  chip.textContent = label;

  fragment.append(input, chip);
  return fragment;
}

// =======================
// 進捗バーと内訳
// =======================
function countStages() {
  const counts = { new: 0, miss: 0, hit: 0, double: 0, triple: 0 };

  state.allQuestions.forEach(question => {
    counts[stageOf(question.id)] += 1;
  });

  return counts;
}

function renderMastery() {
  const counts = countStages();
  const total = state.allQuestions.length;

  if (total === 0) return;

  ["triple", "double", "hit", "miss", "new"].forEach(key => {
    const percent = (counts[key] / total) * 100;
    document.getElementById(`seg-${key}`).style.width = `${percent}%`;
  });

  STAGES.forEach(stage => {
    const countEl = document.getElementById(`count-${stage.key}`);
    if (countEl) countEl.textContent = String(counts[stage.key]);

    const chipCount = document.getElementById(`chip-count-${stage.key}`);
    if (chipCount) chipCount.textContent = String(counts[stage.key]);
  });

  const triplePercent = Math.round((counts.triple / total) * 100);
  document.getElementById("mastery-headline").textContent =
    `トリプル ${counts.triple} / ${total}　（${triplePercent}%）`;

  const bar = document.getElementById("mastery-bar");
  bar.setAttribute("aria-valuenow", String(triplePercent));
  bar.setAttribute(
    "aria-valuetext",
    `全${total}問中、トリプル${counts.triple}問、ダブル${counts.double}問、` +
    `ヒット${counts.hit}問、ミス${counts.miss}問、未出題${counts.new}問`
  );
}

function resetProgress() {
  const answered = state.allQuestions.length - countStages().new;

  if (answered === 0) return;

  const ok = window.confirm(
    `${answered}問分の進捗をすべて消して、全問を未出題に戻します。よろしいですか。`
  );

  if (!ok) return;

  state.progress = {};
  saveProgress();
  renderMastery();
  updateAvailableCounts();
}

// =======================
// 科目 一括選択／解除
// =======================
function toggleAllCategories() {
  const inputs = [...document.querySelectorAll('input[name="category"]')];
  const allChecked = inputs.length > 0 && inputs.every(input => input.checked);
  const next = !allChecked;

  inputs.forEach(input => {
    input.checked = next;
  });

  updateCategoryToggleLabel();
  updateAvailableCounts();
}

function updateCategoryToggleLabel() {
  const inputs = [...document.querySelectorAll('input[name="category"]')];
  const allChecked = inputs.length > 0 && inputs.every(input => input.checked);

  document.getElementById("category-toggle-btn").textContent =
    allChecked ? "すべて解除" : "すべて選択";
}

document.addEventListener("change", event => {
  const name = event.target.name;

  if (name === "category") {
    updateCategoryToggleLabel();
  }

  if (name === "year" || name === "category" || name === "stage") {
    updateAvailableCounts();
  }
});

// =======================
// 試験開始
// =======================
function startExam() {
  clearStartError();

  const yearValue = document.querySelector('input[name="year"]:checked')?.value;
  const countValue = document.querySelector('input[name="count"]:checked')?.value;
  const filters = readFilters();

  if (!yearValue || !countValue) {
    showStartError("年度と出題問数を選択してください。");
    return;
  }

  if (filters.categories.length === 0) {
    showStartError("科目を1つ以上選択してください。");
    return;
  }

  if (filters.stages.length === 0) {
    showStartError("出題状態を1つ以上選択してください。");
    return;
  }

  const pool = filterQuestions(state.allQuestions, filters);

  if (pool.length === 0) {
    showStartError("選択した条件に該当する問題がありません。");
    return;
  }

  const questionCount = countValue === "all" ? pool.length : Number(countValue);

  if (countValue !== "all" && pool.length < questionCount) {
    showStartError(
      `選択した条件には${pool.length}問しかありません。` +
      `出題問数を${pool.length}問以下にしてください。`
    );
    return;
  }

  // 問題順だけをシャッフルする。
  // 国内旅行の問題は「選択肢4」など番号自体を参照することがあるため、選択肢順は絶対に変えない。
  state.questions = shuffle(pool)
    .slice(0, questionCount)
    .map(question => ({
      ...question,
      displayChoices: [...question.choices]
    }));

  state.answers = {};
  state.currentIndex = 0;

  showScreen("screen-quiz");
  renderQuestion();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// =======================
// 出題対象の抽出
// =======================
function readFilters() {
  const yearValue = document.querySelector('input[name="year"]:checked')?.value;

  return {
    year: yearValue === "all" ? "all" : Number(yearValue),
    categories: [...document.querySelectorAll('input[name="category"]:checked')]
      .map(input => input.value),
    stages: [...document.querySelectorAll('input[name="stage"]:checked')]
      .map(input => input.value)
  };
}

function filterQuestions(allQuestions, filters) {
  return allQuestions.filter(question => {
    const yearMatches =
      filters.year === "all" || Number(question.year) === filters.year;

    if (!yearMatches) return false;

    if (!filters.categories.includes(String(question.category ?? ""))) return false;

    return filters.stages.includes(stageOf(question.id));
  });
}

// =======================
// 選択条件に応じた出題問数の制御
// =======================
function updateAvailableCounts() {
  if (state.allQuestions.length === 0) return;

  const filters = readFilters();

  const ready =
    filters.year !== undefined &&
    filters.categories.length > 0 &&
    filters.stages.length > 0;

  const availableCount = ready
    ? filterQuestions(state.allQuestions, filters).length
    : 0;

  const countInputs = [...document.querySelectorAll('input[name="count"]')];

  countInputs.forEach(input => {
    input.disabled = input.value === "all"
      ? availableCount === 0
      : Number(input.value) > availableCount;
  });

  document.getElementById("count-all-num").textContent = String(availableCount);

  const selectedInput = document.querySelector('input[name="count"]:checked');

  if (!selectedInput || selectedInput.disabled) {
    const largestAvailable =
      countInputs.find(input => input.value !== "all" && !input.disabled) ??
      countInputs.find(input => !input.disabled);

    if (largestAvailable) {
      largestAvailable.checked = true;
    }
  }

  const availability = document.getElementById("count-availability");

  if (availableCount === 0) {
    availability.textContent = "条件に合う問題がありません";
  } else {
    availability.textContent = `1つ選択・現在の対象は${availableCount}問`;
  }

  document.getElementById("start-btn").disabled = availableCount === 0;
  clearStartError();
}

// Fisher-Yates shuffle
function shuffle(items) {
  const result = [...items];

  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }

  return result;
}

// =======================
// 問題表示
// =======================
function renderQuestion() {
  const question = state.questions[state.currentIndex];
  const total = state.questions.length;
  const current = state.currentIndex + 1;

  document.getElementById("question-meta").textContent =
    `${question.year}年度　第${question.questionNumber}問`;

  const categoryTag = document.getElementById("question-category");
  categoryTag.textContent = question.category || "";
  categoryTag.hidden = !question.category;

  const stageTag = document.getElementById("question-stage");
  stageTag.textContent = stageLabel(stageOf(question.id));
  stageTag.className = `stage-tag stage-${stageOf(question.id)}`;

  document.getElementById("question-counter").textContent = `${current} / ${total}`;

  updateProgress(current, total);

  const questionText = document.getElementById("question-text");
  questionText.textContent = question.question;

  renderQuestionImages(question);
  renderQuestionNote(question);
  renderSourceLink(question);

  const answerArea = document.getElementById("answer-area");
  answerArea.innerHTML = "";

  renderChoices(answerArea, question);
  restoreAnswer(question);

  const nextButton = document.getElementById("next-btn");
  nextButton.textContent =
    state.currentIndex === total - 1 ? "結果を見る" : "次へ";

  questionText.focus({ preventScroll: true });
}

function updateProgress(current, total) {
  const percent = Math.round((current / total) * 100);

  document.getElementById("progress-fill").style.width = `${percent}%`;
  document.getElementById("progress-bar").setAttribute("aria-valuenow", String(percent));
}

function renderQuestionNote(question) {
  const note = document.getElementById("question-note");
  const messages = [];

  if (question.answerType === "multiple") {
    messages.push("複数選択問題です。該当する選択肢をすべて選んでください。");
  }

  if (question.choiceMode === "long") {
    messages.push("長い選択肢は「全文を見る」で展開できます。");
  }

  note.textContent = messages.join(" ");
  note.hidden = messages.length === 0;
}

function renderQuestionImages(question) {
  const area = document.getElementById("question-image-area");
  area.innerHTML = "";

  const urls = splitImageUrls(question.questionImage);
  area.hidden = urls.length === 0;

  urls.forEach((url, index) => {
    const figure = document.createElement("figure");
    figure.className = "question-image-wrap";

    const image = document.createElement("img");
    image.className = "question-image";
    image.src = url;
    image.alt = `問題図 ${index + 1}`;
    image.loading = "lazy";
    image.decoding = "async";
    image.referrerPolicy = "no-referrer";

    const fallback = document.createElement("p");
    fallback.className = "image-fallback";
    fallback.textContent = "問題画像を表示できません。元問題リンクを確認してください。";
    fallback.hidden = true;

    image.addEventListener("error", () => {
      image.hidden = true;
      fallback.hidden = false;
    });

    figure.append(image, fallback);
    area.appendChild(figure);
  });
}

function renderSourceLink(question) {
  const link = document.getElementById("question-source-link");

  if (!question.sourceUrl) {
    link.hidden = true;
    link.removeAttribute("href");
    return;
  }

  link.href = question.sourceUrl;
  link.hidden = false;
}

function splitImageUrls(value) {
  if (!value) return [];

  return String(value)
    .split("|")
    .map(url => url.trim())
    .filter(Boolean);
}

// =======================
// 回答UI
// =======================
function renderChoices(area, question) {
  question.displayChoices.forEach(choice => {
    const shell = document.createElement("div");
    shell.className = "choice-shell";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "choice-btn";
    button.dataset.key = String(choice.key);
    button.setAttribute("aria-pressed", "false");

    const marker = document.createElement("span");
    marker.className = "choice-marker";
    marker.setAttribute("aria-hidden", "true");
    marker.textContent = CHOICE_MARKERS[Number(choice.key) - 1] ?? String(choice.key);

    const content = document.createElement("span");
    content.className = "choice-content";

    const textValue = String(choice.text ?? "").trim();
    const isLong = question.choiceMode === "long" &&
      (textValue.length >= 120 || textValue.includes("\n"));

    if (textValue) {
      const text = document.createElement("span");
      text.className = `choice-text${isLong ? " choice-text-long" : ""}`;
      text.textContent = textValue;
      content.appendChild(text);
    }

    if (choice.image) {
      content.appendChild(createChoiceImage(choice.image, choice.key));
    }

    if (!textValue && !choice.image) {
      const missing = document.createElement("span");
      missing.className = "choice-text";
      missing.textContent = "選択肢データなし";
      content.appendChild(missing);
    }

    button.append(marker, content);

    button.addEventListener("click", () => {
      selectChoice(question, Number(choice.key));
      highlightChoices(area, state.answers[question.id] ?? []);
    });

    shell.appendChild(button);

    if (isLong) {
      const expand = document.createElement("button");
      expand.type = "button";
      expand.className = "choice-expand-btn";
      expand.textContent = "全文を見る";
      expand.setAttribute("aria-expanded", "false");

      expand.addEventListener("click", () => {
        const expanded = shell.classList.toggle("is-expanded");
        expand.textContent = expanded ? "折りたたむ" : "全文を見る";
        expand.setAttribute("aria-expanded", String(expanded));
      });

      shell.appendChild(expand);
    }

    area.appendChild(shell);
  });
}

function createChoiceImage(url, key) {
  const wrap = document.createElement("span");
  wrap.className = "choice-image-wrap";

  const image = document.createElement("img");
  image.className = "choice-image";
  image.src = url;
  image.alt = `選択肢${key}の画像`;
  image.loading = "lazy";
  image.decoding = "async";
  image.referrerPolicy = "no-referrer";

  const fallback = document.createElement("span");
  fallback.className = "image-fallback image-fallback-inline";
  fallback.textContent = "画像を表示できません";
  fallback.hidden = true;

  image.addEventListener("error", () => {
    image.hidden = true;
    fallback.hidden = false;
  });

  wrap.append(image, fallback);
  return wrap;
}

function selectChoice(question, choiceKey) {
  const current = normalizeKeys(state.answers[question.id]);

  if (question.answerType === "multiple") {
    state.answers[question.id] = current.includes(choiceKey)
      ? current.filter(key => key !== choiceKey)
      : [...current, choiceKey].sort((a, b) => a - b);
    return;
  }

  state.answers[question.id] = [choiceKey];
}

function highlightChoices(container, selectedKeys) {
  const normalized = normalizeKeys(selectedKeys);

  [...container.querySelectorAll(".choice-btn")].forEach(button => {
    const selected = normalized.includes(Number(button.dataset.key));

    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
}

// =======================
// 回答復元
// =======================
function restoreAnswer(question) {
  const answer = state.answers[question.id];

  if (answer === undefined) return;

  highlightChoices(document.getElementById("answer-area"), answer);
}

// =======================
// キーボード操作（1〜4で選択、Enterで次へ）
// =======================
function handleQuizKeydown(event) {
  const quizScreen = document.getElementById("screen-quiz");

  if (quizScreen.hidden) return;
  if (event.ctrlKey || event.metaKey || event.altKey) return;

  const numericKey = Number(event.key);

  if (CHOICE_KEYS.includes(numericKey)) {
    const button = document.querySelector(`#answer-area .choice-btn[data-key="${numericKey}"]`);

    if (button) {
      button.click();
      event.preventDefault();
    }
    return;
  }

  if (event.key === "Enter") {
    const active = document.activeElement;
    const interactive = active?.matches?.("button, a, input, select, textarea");

    if (!interactive) {
      nextQuestion();
      event.preventDefault();
    }
  }
}

// =======================
// 次へ
// =======================
function nextQuestion() {
  if (state.currentIndex < state.questions.length - 1) {
    state.currentIndex += 1;
    renderQuestion();
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }

  showResult();
}

// =======================
// 採点
// =======================
function normalizeKeys(value) {
  const source = Array.isArray(value)
    ? value
    : value === undefined || value === null || value === ""
      ? []
      : [value];

  return [...new Set(source.map(Number).filter(key => CHOICE_KEYS.includes(key)))]
    .sort((a, b) => a - b);
}

function judge(question, answer) {
  const actual = normalizeKeys(answer);
  const correct = normalizeKeys(question.correct);

  return actual.length === correct.length &&
    actual.every((key, index) => key === correct[index]);
}

// 正解なら1段上げる（トリプルで打ち止め）。誤答と未回答はミスに戻す。
function applyResult(questionId, isCorrect) {
  const before = stageOf(questionId);
  const current = state.progress[questionId] ?? 0;

  state.progress[questionId] = isCorrect
    ? Math.min(current + 1, MAX_STREAK)
    : 0;

  return { before, after: stageOf(questionId) };
}

// =======================
// 結果表示
// =======================
function showResult() {
  showScreen("screen-result");

  let correctCount = 0;
  const list = document.getElementById("result-list");
  list.innerHTML = "";

  const transitions = state.questions.map(question => {
    const answer = state.answers[question.id];
    const isCorrect = judge(question, answer);

    if (isCorrect) correctCount += 1;

    return { question, answer, isCorrect, ...applyResult(question.id, isCorrect) };
  });

  saveProgress();
  renderMastery();
  updateAvailableCounts();

  transitions.forEach((entry, index) => {
    list.appendChild(createResultItem(entry, index));
  });

  const total = state.questions.length;
  const percent = Math.round((correctCount / total) * 100);

  const score = document.getElementById("score");
  score.innerHTML = "";

  const scoreNum = document.createElement("span");
  scoreNum.className = "score-num";
  scoreNum.textContent = String(correctCount);

  score.append("得点 ", scoreNum, ` / ${total}`);

  document.getElementById("score-percent").textContent = `正答率 ${percent}%`;
  document.getElementById("score-sub").textContent =
    percent === 100 ? "全問正解です。" :
    percent >= 80 ? "かなり安定しています。" :
    percent >= 60 ? "ミスした問題を復習すると伸ばせます。" :
    "ミスした問題を中心にもう一周してみましょう。";

  const promoted = transitions.filter(
    entry => entry.after === "triple" && entry.before !== "triple"
  ).length;
  const dropped = transitions.filter(
    entry => !entry.isCorrect && entry.before !== "new" && entry.before !== "miss"
  ).length;

  const changes = [];
  if (promoted > 0) changes.push(`トリプル到達 ${promoted}問`);
  if (dropped > 0) changes.push(`ミスに後退 ${dropped}問`);

  document.getElementById("score-changes").textContent = changes.join("　／　");

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function createResultItem(entry, index) {
  const { question, answer, isCorrect, before, after } = entry;

  const item = document.createElement("li");
  item.className = `result-item ${isCorrect ? "is-correct" : "is-incorrect"}`;

  const badge = document.createElement("span");
  badge.className = "result-badge";
  badge.textContent = isCorrect ? "○" : "×";
  badge.setAttribute("role", "img");
  badge.setAttribute("aria-label", isCorrect ? "正解" : "不正解");

  const body = document.createElement("div");
  body.className = "result-body";

  const meta = document.createElement("p");
  meta.className = "result-meta";
  meta.textContent =
    `Q${index + 1}　${question.year}年度　第${question.questionNumber}問　${question.category ?? ""}`;

  const text = document.createElement("p");
  text.className = "result-question";
  text.textContent = question.question;

  const answers = document.createElement("dl");
  answers.className = "result-answers";

  answers.appendChild(
    createAnswerLine("正解", formatAnswer(question, question.correct), "answer-correct")
  );

  answers.appendChild(
    createAnswerLine(
      "あなたの答え",
      normalizeKeys(answer).length === 0 ? "未回答" : formatAnswer(question, answer),
      isCorrect ? "answer-correct" : "answer-wrong"
    )
  );

  const transition = document.createElement("p");
  transition.className = "result-transition";

  const fromTag = document.createElement("span");
  fromTag.className = `stage-tag stage-${before}`;
  fromTag.textContent = stageLabel(before);

  const toTag = document.createElement("span");
  toTag.className = `stage-tag stage-${after}`;
  toTag.textContent = stageLabel(after);

  transition.append(fromTag, " → ", toTag);

  body.append(meta, text, answers, transition);
  item.append(badge, body);

  return item;
}

function formatAnswer(question, keys) {
  const normalized = normalizeKeys(keys);

  if (normalized.length === 0) return "未回答";

  return normalized
    .map(key => {
      const choice = question.choices.find(item => Number(item.key) === key);
      const marker = CHOICE_MARKERS[key - 1] ?? String(key);

      if (!choice) return marker;

      const text = String(choice.text ?? "").replace(/\s+/g, " ").trim();

      if (text) {
        const compact = text.length > 90 ? `${text.slice(0, 90)}…` : text;
        return `${marker} ${compact}`;
      }

      if (choice.image) return `${marker} 画像選択肢`;

      return marker;
    })
    .join(" / ");
}

function createAnswerLine(labelText, value, valueClass) {
  const line = document.createElement("div");

  const label = document.createElement("dt");
  label.textContent = labelText;

  const detail = document.createElement("dd");
  detail.textContent = value;
  detail.className = valueClass;

  line.append(label, detail);

  return line;
}

// =======================
// エラー表示
// =======================
function showStartError(message) {
  const area = document.getElementById("start-error");
  area.textContent = message;
  area.hidden = false;
}

function clearStartError() {
  const area = document.getElementById("start-error");
  area.textContent = "";
  area.hidden = true;
}

// =======================
// 画面切り替え
// =======================
function showScreen(id) {
  ["screen-start", "screen-quiz", "screen-result"].forEach(screenId => {
    document.getElementById(screenId).hidden = true;
  });

  document.getElementById(id).hidden = false;
}

// =======================
// 戻る
// =======================
function backToStart() {
  state.questions = [];
  state.answers = {};
  state.currentIndex = 0;

  renderMastery();
  updateAvailableCounts();
  showScreen("screen-start");
  window.scrollTo({ top: 0, behavior: "smooth" });
}
