"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { createClient, type Session } from "@supabase/supabase-js";

type AgendaCategory = {
  id: string;
  name: string;
  color: string;
  updatedAt?: string;
};

type CalendarEvent = {
  id: string;
  title: string;
  time: string;
  categoryId: string | null;
  notes: string;
  done: boolean;
  hasReminder: boolean;
  reminderAt: string;
  updatedAt?: string;
};

type EventDraft = Omit<CalendarEvent, "id" | "updatedAt">;

type AgendaEventRow = {
  id: string;
  date: string;
  title: string;
  event_time: string;
  category: string | null;
  category_id: string | null;
  notes: string | null;
  done: boolean;
  has_reminder: boolean | null;
  reminder_at: string | null;
  updated_at: string | null;
};

type AgendaCategoryRow = {
  id: string;
  name: string;
  color: string;
  updated_at: string | null;
};

type EventsByDate = Record<string, CalendarEvent[]>;
type CalendarView = "month" | "week";
type DuplicateMode = "daily" | "custom-days";
type EditorMode = "hidden" | "create" | "edit";

const STORAGE_KEY = "agenda-web-events";
const CATEGORY_STORAGE_KEY = "agenda-web-categories";
const CALENDAR_NAME_KEY = "agenda-web-calendar-name";
const DEFAULT_CALENDAR_NAME = "Calendario personal";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const weekdays = ["Lun", "Mar", "Mie", "Jue", "Vie", "Sab", "Dom"];
const recurrenceWeekdays = weekdays.map((label, value) => ({ label, value }));
const DEFAULT_CATEGORIES: AgendaCategory[] = [
  { id: "default-trabajo", name: "Trabajo", color: "#7dd3fc" },
  { id: "default-personal", name: "Personal", color: "#ffd166" },
  { id: "default-estudio", name: "Estudio", color: "#c4b5fd" },
  { id: "default-salud", name: "Salud", color: "#86efac" },
];
const UNCATEGORIZED_CATEGORY: AgendaCategory = {
  id: "uncategorized",
  name: "Sin categoria",
  color: "#928c83",
};
const CATEGORY_NAME_FALLBACK = "Sin categoria";
const NEW_CATEGORY_COLOR = "#44d7a8";
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

const rowSelect =
  "id,date,title,event_time,category,category_id,notes,done,has_reminder,reminder_at,updated_at";

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function fromDateKey(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function addDaysToDateKey(key: string, amount: number) {
  const date = fromDateKey(key);
  date.setDate(date.getDate() + amount);
  return toDateKey(date);
}

function getWeekdayIndex(date: Date) {
  return (date.getDay() + 6) % 7;
}

function createDateKeysUntil(startKey: string, endKey: string, maxDays = 365) {
  const currentDate = fromDateKey(startKey);
  const endDate = fromDateKey(endKey);
  const dates: string[] = [];

  currentDate.setDate(currentDate.getDate() + 1);

  while (currentDate <= endDate && dates.length < maxDays) {
    dates.push(toDateKey(currentDate));
    currentDate.setDate(currentDate.getDate() + 1);
  }

  return dates;
}

function formatMonth(date: Date) {
  return new Intl.DateTimeFormat("es", {
    month: "long",
    year: "numeric",
  }).format(date);
}

function formatLongDate(key: string) {
  return new Intl.DateTimeFormat("es", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(fromDateKey(key));
}

function formatShortDate(date: Date) {
  return new Intl.DateTimeFormat("es", {
    day: "numeric",
    month: "short",
  }).format(date);
}

function formatDateTimeForInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function defaultReminderAt(dateKey: string, time = "09:00") {
  return `${dateKey}T${time}`;
}

function formatReminder(value: string) {
  if (!value) {
    return "";
  }

  return new Intl.DateTimeFormat("es", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function startOfWeek(date: Date) {
  const mondayOffset = (date.getDay() + 6) % 7;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - mondayOffset);
}

function createWeekDays(date: Date) {
  const start = startOfWeek(date);

  return Array.from({ length: 7 }, (_, index) => (
    new Date(start.getFullYear(), start.getMonth(), start.getDate() + index)
  ));
}

function createMonthDays(monthDate: Date) {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const mondayOffset = (firstDay.getDay() + 6) % 7;
  const days: Date[] = [];

  for (let index = mondayOffset; index > 0; index -= 1) {
    days.push(new Date(year, month, 1 - index));
  }

  for (let day = 1; day <= lastDay.getDate(); day += 1) {
    days.push(new Date(year, month, day));
  }

  while (days.length % 7 !== 0 || days.length < 42) {
    const next = days.length - mondayOffset - lastDay.getDate() + 1;
    days.push(new Date(year, month + 1, next));
  }

  return days;
}

function normalizeCategoryName(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeHexColor(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return HEX_COLOR_PATTERN.test(trimmed) ? trimmed.toLowerCase() : null;
}

function categoryNameExists(categories: AgendaCategory[], name: string, ignoredId?: string) {
  const normalizedName = normalizeCategoryName(name);
  return categories.some(
    (category) =>
      category.id !== ignoredId && normalizeCategoryName(category.name) === normalizedName,
  );
}

function getDefaultCategoryId(categories: AgendaCategory[]) {
  return categories[0]?.id ?? null;
}

function findCategoryByName(categories: AgendaCategory[], name: unknown) {
  const normalizedName = normalizeCategoryName(name);
  return categories.find((category) => normalizeCategoryName(category.name) === normalizedName);
}

function getCategoryDisplay(categories: AgendaCategory[], categoryId: string | null) {
  if (!categoryId) {
    return UNCATEGORIZED_CATEGORY;
  }

  return categories.find((category) => category.id === categoryId) ?? UNCATEGORIZED_CATEGORY;
}

function getCategoryName(categories: AgendaCategory[], categoryId: string | null) {
  return getCategoryDisplay(categories, categoryId).name;
}

function hexToRgba(hex: string, opacity: number) {
  const validHex = normalizeHexColor(hex) ?? UNCATEGORIZED_CATEGORY.color;
  const red = Number.parseInt(validHex.slice(1, 3), 16);
  const green = Number.parseInt(validHex.slice(3, 5), 16);
  const blue = Number.parseInt(validHex.slice(5, 7), 16);

  return `rgba(${red}, ${green}, ${blue}, ${opacity})`;
}

function categoryStyle(category: AgendaCategory): CSSProperties {
  return {
    "--category-color": category.color,
    "--category-bg": hexToRgba(category.color, 0.18),
  } as CSSProperties;
}

function makeUniqueCategoryName(categories: AgendaCategory[], baseName = "Nueva categoria") {
  if (!categoryNameExists(categories, baseName)) {
    return baseName;
  }

  for (let index = 2; index < 100; index += 1) {
    const nextName = `${baseName} ${index}`;

    if (!categoryNameExists(categories, nextName)) {
      return nextName;
    }
  }

  return `${baseName} ${crypto.randomUUID().slice(0, 4)}`;
}

function normalizeStoredCategory(category: Partial<AgendaCategory>) {
  const fallback = DEFAULT_CATEGORIES[0];
  const color = normalizeHexColor(category.color) ?? fallback.color;

  return {
    id: typeof category.id === "string" && category.id ? category.id : crypto.randomUUID(),
    name:
      typeof category.name === "string" && category.name.trim()
        ? category.name.trim()
        : fallback.name,
    color,
    updatedAt: typeof category.updatedAt === "string" ? category.updatedAt : undefined,
  };
}

function parseLocalCategories(savedCategories: string | null) {
  if (!savedCategories) {
    return DEFAULT_CATEGORIES;
  }

  try {
    const parsed = JSON.parse(savedCategories) as Partial<AgendaCategory>[];

    if (!Array.isArray(parsed)) {
      return DEFAULT_CATEGORIES;
    }

    const normalizedCategories = parsed.reduce<AgendaCategory[]>((items, category) => {
      const normalizedCategory = normalizeStoredCategory(category);

      if (!categoryNameExists(items, normalizedCategory.name)) {
        items.push(normalizedCategory);
      }

      return items;
    }, []);

    return normalizedCategories;
  } catch {
    return DEFAULT_CATEGORIES;
  }
}

function rowToCategory(row: AgendaCategoryRow): AgendaCategory {
  return {
    id: row.id,
    name: row.name,
    color: normalizeHexColor(row.color) ?? NEW_CATEGORY_COLOR,
    updatedAt: row.updated_at ?? undefined,
  };
}

type StoredCalendarEvent = Partial<CalendarEvent> & {
  category?: string | null;
  category_id?: string | null;
};

function normalizeStoredEvent(event: StoredCalendarEvent, categories: AgendaCategory[]) {
  const time = typeof event.time === "string" && event.time ? event.time : "09:00";
  const legacyCategory = findCategoryByName(categories, event.category);
  const storedCategoryExists =
    typeof event.categoryId === "string" &&
    categories.some((category) => category.id === event.categoryId);
  const databaseCategoryExists =
    typeof event.category_id === "string" &&
    categories.some((category) => category.id === event.category_id);

  return {
    id: typeof event.id === "string" ? event.id : crypto.randomUUID(),
    title: typeof event.title === "string" && event.title ? event.title : "Nota",
    time,
    categoryId: storedCategoryExists
      ? event.categoryId ?? null
      : databaseCategoryExists
        ? event.category_id ?? null
        : legacyCategory?.id ?? null,
    notes: typeof event.notes === "string" ? event.notes : "",
    done: Boolean(event.done),
    hasReminder: Boolean(event.hasReminder),
    reminderAt: typeof event.reminderAt === "string" ? event.reminderAt : "",
    updatedAt: typeof event.updatedAt === "string" ? event.updatedAt : undefined,
  };
}

function rowToEvent(row: AgendaEventRow, categories: AgendaCategory[]): CalendarEvent {
  const legacyCategory = findCategoryByName(categories, row.category);

  return {
    id: row.id,
    title: row.title,
    time: (row.event_time ?? "09:00").slice(0, 5),
    categoryId: row.category_id ?? legacyCategory?.id ?? null,
    notes: row.notes ?? "",
    done: row.done,
    hasReminder: Boolean(row.has_reminder),
    reminderAt: row.reminder_at ? formatDateTimeForInput(new Date(row.reminder_at)) : "",
    updatedAt: row.updated_at ?? undefined,
  };
}

function rowsToEvents(rows: AgendaEventRow[], categories: AgendaCategory[]) {
  return rows.reduce<EventsByDate>((calendarEvents, row) => {
    calendarEvents[row.date] = [
      ...(calendarEvents[row.date] ?? []),
      rowToEvent(row, categories),
    ].sort((a, b) => a.time.localeCompare(b.time));
    return calendarEvents;
  }, {});
}

function setSingleEventForDate(events: EventsByDate, date: string, event: CalendarEvent) {
  return {
    ...events,
    [date]: [event],
  };
}

function addEventToDate(events: EventsByDate, date: string, event: CalendarEvent) {
  return {
    ...events,
    [date]: [...(events[date] ?? []), event].sort((a, b) => a.time.localeCompare(b.time)),
  };
}

function replaceEventInDate(
  events: EventsByDate,
  date: string,
  eventId: string,
  nextEvent: CalendarEvent,
) {
  const updatedEvents = (events[date] ?? []).map((event) =>
    event.id === eventId ? nextEvent : event,
  );
  const eventExists = updatedEvents.some((event) => event.id === nextEvent.id);

  return {
    ...events,
    [date]: (eventExists ? updatedEvents : [...updatedEvents, nextEvent]).sort((a, b) =>
      a.time.localeCompare(b.time),
    ),
  };
}

function updateEventDone(events: EventsByDate, date: string, eventId: string, done: boolean) {
  return {
    ...events,
    [date]: (events[date] ?? []).map((event) =>
      event.id === eventId ? { ...event, done } : event,
    ),
  };
}

function removeEventFromDate(events: EventsByDate, date: string, eventId: string) {
  const updatedEvents = (events[date] ?? []).filter((event) => event.id !== eventId);
  const nextEvents = { ...events };

  if (updatedEvents.length === 0) {
    delete nextEvents[date];
  } else {
    nextEvents[date] = updatedEvents;
  }

  return nextEvents;
}

function clearCategoryFromEvents(events: EventsByDate, categoryId: string) {
  return Object.entries(events).reduce<EventsByDate>((nextEvents, [date, dayEvents]) => {
    nextEvents[date] = dayEvents.map((event) =>
      event.categoryId === categoryId ? { ...event, categoryId: null } : event,
    );
    return nextEvents;
  }, {});
}

function parseLocalEvents(savedEvents: string | null, categories: AgendaCategory[]) {
  if (!savedEvents) {
    return {};
  }

  try {
    const parsed = JSON.parse(savedEvents) as Record<string, StoredCalendarEvent[]>;

    return Object.entries(parsed).reduce<EventsByDate>((calendarEvents, [date, dayEvents]) => {
      if (Array.isArray(dayEvents)) {
        calendarEvents[date] = dayEvents
          .map((dayEvent) => normalizeStoredEvent(dayEvent, categories))
          .sort((a, b) => a.time.localeCompare(b.time));
      }

      return calendarEvents;
    }, {});
  } catch {
    return {};
  }
}

function reminderToDatabase(hasReminder: boolean, reminderAt: string) {
  if (!hasReminder || !reminderAt) {
    return null;
  }

  const date = new Date(reminderAt);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function makeEventPayload(date: string, draft: EventDraft, categories: AgendaCategory[]) {
  return {
    date,
    title: draft.title,
    event_time: draft.time,
    category: getCategoryName(categories, draft.categoryId),
    category_id: draft.categoryId,
    notes: draft.notes,
    done: draft.done,
    has_reminder: draft.hasReminder,
    reminder_at: reminderToDatabase(draft.hasReminder, draft.reminderAt),
  };
}

function makeDraftForDate(event: CalendarEvent, date: string): EventDraft {
  const reminderTime = event.reminderAt ? event.reminderAt.slice(11, 16) : event.time;

  return {
    title: event.title,
    time: event.time,
    categoryId: event.categoryId,
    notes: event.notes,
    done: false,
    hasReminder: event.hasReminder,
    reminderAt: event.hasReminder ? defaultReminderAt(date, reminderTime) : "",
  };
}

export default function Home() {
  const todayKey = toDateKey(new Date());
  const supabase = useMemo(() => {
    if (!supabaseUrl || !supabaseKey) {
      return null;
    }

    return createClient(supabaseUrl, supabaseKey);
  }, []);
  const [viewMode, setViewMode] = useState<CalendarView>("month");
  const [monthDate, setMonthDate] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(todayKey);
  const [events, setEvents] = useState<EventsByDate>({});
  const [categories, setCategories] = useState<AgendaCategory[]>(DEFAULT_CATEGORIES);
  const [session, setSession] = useState<Session | null>(null);
  const [calendarName, setCalendarName] = useState(DEFAULT_CALENDAR_NAME);
  const [calendarNameDraft, setCalendarNameDraft] = useState(DEFAULT_CALENDAR_NAME);
  const [isEditingCalendarName, setIsEditingCalendarName] = useState(false);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [editorMode, setEditorMode] = useState<EditorMode>("hidden");
  const [title, setTitle] = useState("");
  const [time, setTime] = useState("09:00");
  const [categoryId, setCategoryId] = useState<string | null>(DEFAULT_CATEGORIES[0].id);
  const [isCategoryMenuOpen, setIsCategoryMenuOpen] = useState(false);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [categoryNameDraft, setCategoryNameDraft] = useState("");
  const [categoryColorDraft, setCategoryColorDraft] = useState(NEW_CATEGORY_COLOR);
  const [categoryMessage, setCategoryMessage] = useState("");
  const [notes, setNotes] = useState("");
  const [hasReminder, setHasReminder] = useState(false);
  const [reminderAt, setReminderAt] = useState(defaultReminderAt(todayKey));
  const [duplicateMode, setDuplicateMode] = useState<DuplicateMode>("daily");
  const [duplicateUntilDate, setDuplicateUntilDate] = useState(addDaysToDateKey(todayKey, 7));
  const [duplicateWeekdays, setDuplicateWeekdays] = useState<number[]>(() => [
    getWeekdayIndex(fromDateKey(todayKey)),
  ]);
  const [duplicateMessage, setDuplicateMessage] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [syncMessage, setSyncMessage] = useState("");
  const [isMounted, setIsMounted] = useState(false);
  const [dataLoading, setDataLoading] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const categoriesRef = useRef(DEFAULT_CATEGORIES);

  const selectedDateObject = useMemo(() => fromDateKey(selectedDate), [selectedDate]);
  const monthDays = useMemo(() => createMonthDays(monthDate), [monthDate]);
  const weekDays = useMemo(() => createWeekDays(selectedDateObject), [selectedDateObject]);
  const selectedEvents = events[selectedDate] ?? [];
  const selectedEvent = selectedEvents.find((event) => event.id === editingEventId) ?? null;
  const weekRange = `${formatShortDate(weekDays[0])} - ${formatShortDate(weekDays[6])}`;
  const userId = session?.user.id;
  const selectedCategory = useMemo(
    () => getCategoryDisplay(categories, categoryId),
    [categories, categoryId],
  );

  useEffect(() => {
    let ignore = false;

    async function boot() {
      await Promise.resolve();

      const savedCalendarName = window.localStorage.getItem(CALENDAR_NAME_KEY);

      if (savedCalendarName?.trim()) {
        setCalendarName(savedCalendarName.trim());
        setCalendarNameDraft(savedCalendarName.trim());
      }

      if (!supabase) {
        const localCategories = parseLocalCategories(
          window.localStorage.getItem(CATEGORY_STORAGE_KEY),
        );
        const savedEvents = window.localStorage.getItem(STORAGE_KEY);

        if (!ignore) {
          setCategories(localCategories);
          setCategoryId(getDefaultCategoryId(localCategories));
          setEvents(parseLocalEvents(savedEvents, localCategories));
          setIsMounted(true);
        }

        return;
      }

      const { data } = await supabase.auth.getSession();

      if (!ignore) {
        setSession(data.session);
        setIsMounted(true);
      }
    }

    void boot();

    if (!supabase) {
      return () => {
        ignore = true;
      };
    }

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);

      if (!nextSession) {
        setEvents({});
        setCategories(DEFAULT_CATEGORIES);
      }
    });

    return () => {
      ignore = true;
      data.subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    if (!supabase && isMounted) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
    }
  }, [events, isMounted, supabase]);

  useEffect(() => {
    categoriesRef.current = categories;
  }, [categories]);

  useEffect(() => {
    if (!supabase && isMounted) {
      window.localStorage.setItem(CATEGORY_STORAGE_KEY, JSON.stringify(categories));
    }
  }, [categories, isMounted, supabase]);

  useEffect(() => {
    if (isMounted) {
      window.localStorage.setItem(CALENDAR_NAME_KEY, calendarName);
    }
  }, [calendarName, isMounted]);

  useEffect(() => {
    if (!supabase || !userId) {
      return;
    }

    const client = supabase;
    let ignore = false;

    async function loadCategories() {
      const { data, error } = await client
        .from("agenda_categories")
        .select("id,name,color,updated_at")
        .order("name", { ascending: true });

      if (error) {
        throw new Error(error.message);
      }

      const loadedCategories = ((data ?? []) as AgendaCategoryRow[]).map(rowToCategory);

      if (loadedCategories.length > 0) {
        return loadedCategories;
      }

      const { data: insertedData, error: insertError } = await client
        .from("agenda_categories")
        .insert(
          DEFAULT_CATEGORIES.map((category) => ({
            user_id: userId,
            name: category.name,
            color: category.color,
          })),
        )
        .select("id,name,color,updated_at");

      if (insertError) {
        throw new Error(insertError.message);
      }

      return [...loadedCategories, ...((insertedData ?? []) as AgendaCategoryRow[]).map(rowToCategory)]
        .sort((a, b) => a.name.localeCompare(b.name));
    }

    async function loadAgenda() {
      setDataLoading(true);
      setSyncMessage("");

      let loadedCategories: AgendaCategory[];

      try {
        loadedCategories = await loadCategories();
      } catch (error) {
        if (!ignore) {
          setSyncMessage(
            `No se pudieron cargar tus categorias: ${
              error instanceof Error ? error.message : "intenta otra vez"
            }`,
          );
          setDataLoading(false);
        }
        return;
      }

      const { data, error } = await client
        .from("agenda_events")
        .select(rowSelect)
        .order("date", { ascending: true })
        .order("event_time", { ascending: true });

      if (ignore) {
        return;
      }

      if (error) {
        setSyncMessage(`No se pudieron cargar tus notas: ${error.message}`);
      } else {
        setCategories(loadedCategories);
        setCategoryId((current) =>
          current && loadedCategories.some((category) => category.id === current)
            ? current
            : getDefaultCategoryId(loadedCategories),
        );
        setEvents(rowsToEvents((data ?? []) as AgendaEventRow[], loadedCategories));
      }

      setDataLoading(false);
    }

    void loadAgenda();

    return () => {
      ignore = true;
    };
  }, [supabase, userId]);

  useEffect(() => {
    let ignore = false;

    async function resetDayEditor() {
      await Promise.resolve();

      if (ignore) {
        return;
      }

      setEditingEventId(null);
      setEditorMode("hidden");
      setTitle("");
      setTime("09:00");
      setCategoryId(getDefaultCategoryId(categoriesRef.current));
      setIsCategoryMenuOpen(false);
      setEditingCategoryId(null);
      setCategoryMessage("");
      setNotes("");
      setHasReminder(false);
      setReminderAt(defaultReminderAt(selectedDate));
      setDuplicateUntilDate(addDaysToDateKey(selectedDate, 7));
      setDuplicateWeekdays([getWeekdayIndex(fromDateKey(selectedDate))]);
      setDuplicateMessage("");
    }

    void resetDayEditor();

    return () => {
      ignore = true;
    };
  }, [selectedDate]);

  function selectDate(date: Date) {
    setSelectedDate(toDateKey(date));
    setMonthDate(new Date(date.getFullYear(), date.getMonth(), 1));
  }

  function changePeriod(amount: number) {
    if (viewMode === "week") {
      const nextDate = new Date(
        selectedDateObject.getFullYear(),
        selectedDateObject.getMonth(),
        selectedDateObject.getDate() + amount * 7,
      );
      selectDate(nextDate);
      return;
    }

    const nextMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + amount, 1);
    setMonthDate(nextMonth);
    setSelectedDate(toDateKey(nextMonth));
  }

  function goToToday() {
    const now = new Date();
    selectDate(now);
  }

  function saveCalendarName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextName = calendarNameDraft.trim() || DEFAULT_CALENDAR_NAME;
    setCalendarName(nextName);
    setCalendarNameDraft(nextName);
    setIsEditingCalendarName(false);
  }

  function resetNoteForm() {
    setTitle("");
    setTime("09:00");
    setCategoryId(getDefaultCategoryId(categories));
    setIsCategoryMenuOpen(false);
    setEditingCategoryId(null);
    setCategoryMessage("");
    setNotes("");
    setHasReminder(false);
    setReminderAt(defaultReminderAt(selectedDate));
  }

  function startNewNote() {
    setEditingEventId(null);
    setEditorMode("create");
    resetNoteForm();
  }

  function cancelEditor() {
    setEditingEventId(null);
    setEditorMode("hidden");
    resetNoteForm();
  }

  function fillEditor(calendarEvent: CalendarEvent) {
    setEditingEventId(calendarEvent.id);
    setEditorMode("edit");
    setTitle(calendarEvent.title);
    setTime(calendarEvent.time);
    setCategoryId(calendarEvent.categoryId);
    setIsCategoryMenuOpen(false);
    setEditingCategoryId(null);
    setCategoryMessage("");
    setNotes(calendarEvent.notes);
    setHasReminder(calendarEvent.hasReminder);
    setReminderAt(calendarEvent.reminderAt || defaultReminderAt(selectedDate, calendarEvent.time));
  }

  function toggleDuplicateWeekday(weekday: number) {
    setDuplicateWeekdays((current) =>
      current.includes(weekday)
        ? current.filter((item) => item !== weekday)
        : [...current, weekday].sort((a, b) => a - b),
    );
  }

  function buildDraft(done: boolean): EventDraft | null {
    if (!title.trim()) {
      return null;
    }

    return {
      title: title.trim(),
      time,
      categoryId,
      notes: notes.trim(),
      done,
      hasReminder,
      reminderAt: hasReminder ? reminderAt || defaultReminderAt(selectedDate, time) : "",
    };
  }

  function buildDuplicateTargets() {
    const dates = createDateKeysUntil(selectedDate, duplicateUntilDate);

    if (duplicateMode === "daily") {
      return dates;
    }

    const selectedWeekdays = new Set(duplicateWeekdays);
    return dates.filter((date) => selectedWeekdays.has(getWeekdayIndex(fromDateKey(date))));
  }

  async function deleteExtraRemoteEvents(date: string, keepEventId: string) {
    if (!supabase || !session) {
      return null;
    }

    const extraIds = (events[date] ?? [])
      .filter((event) => event.id !== keepEventId)
      .map((event) => event.id);

    if (extraIds.length === 0) {
      return null;
    }

    const { error } = await supabase
      .from("agenda_events")
      .delete()
      .eq("user_id", session.user.id)
      .in("id", extraIds);

    return error;
  }

  async function signInWithEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!supabase || !authEmail.trim()) {
      return;
    }

    setAuthLoading(true);
    setAuthMessage("");

    const { error } = await supabase.auth.signInWithOtp({
      email: authEmail.trim(),
      options: {
        emailRedirectTo: window.location.origin,
      },
    });

    setAuthLoading(false);
    setAuthMessage(
      error
        ? `No se pudo enviar el enlace: ${error.message}`
        : "Te enviamos un enlace de acceso. Revisa tu correo.",
    );
  }

  async function signOut() {
    if (!supabase) {
      return;
    }

    await supabase.auth.signOut();
    setEvents({});
    setSyncMessage("");
  }

  async function saveEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const existingEvent = editorMode === "edit" ? selectedEvent : null;
    const draft = buildDraft(existingEvent?.done ?? false);

    if (!draft) {
      return;
    }

    const localEvent: CalendarEvent = {
      ...draft,
      id: existingEvent?.id ?? crypto.randomUUID(),
    };

    if (supabase && session) {
      setDataLoading(true);
      setSyncMessage("");

      if (existingEvent) {
        const { data, error } = await supabase
          .from("agenda_events")
          .update(makeEventPayload(selectedDate, localEvent, categories))
          .eq("id", existingEvent.id)
          .eq("user_id", session.user.id)
          .select(rowSelect)
          .single();

        if (error || !data) {
          setDataLoading(false);
          setSyncMessage(`No se pudo actualizar la nota: ${error?.message ?? "intenta otra vez"}`);
          return;
        }

        const savedEvent = rowToEvent(data as AgendaEventRow, categories);
        setEvents((current) => replaceEventInDate(current, selectedDate, existingEvent.id, savedEvent));
        setEditingEventId(savedEvent.id);
        setEditorMode("edit");
        setDataLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from("agenda_events")
        .insert({
          user_id: session.user.id,
          ...makeEventPayload(selectedDate, localEvent, categories),
        })
        .select(rowSelect)
        .single();

      setDataLoading(false);

      if (error || !data) {
        setSyncMessage(`No se pudo guardar la nota: ${error?.message ?? "intenta otra vez"}`);
        return;
      }

      const savedEvent = rowToEvent(data as AgendaEventRow, categories);
      setEvents((current) => addEventToDate(current, selectedDate, savedEvent));
      setEditingEventId(savedEvent.id);
      setEditorMode("edit");
      return;
    }

    setEvents((current) =>
      existingEvent
        ? replaceEventInDate(current, selectedDate, existingEvent.id, localEvent)
        : addEventToDate(current, selectedDate, localEvent),
    );
    setEditingEventId(localEvent.id);
    setEditorMode("edit");
  }

  async function saveDuplicateToDate(targetDate: string, draft: EventDraft) {
    const existingTarget = events[targetDate]?.[0] ?? null;
    const localEvent: CalendarEvent = {
      ...draft,
      id: existingTarget?.id ?? crypto.randomUUID(),
    };

    if (supabase && session) {
      if (existingTarget) {
        const { data, error } = await supabase
          .from("agenda_events")
          .update(makeEventPayload(targetDate, localEvent, categories))
          .eq("id", existingTarget.id)
          .eq("user_id", session.user.id)
          .select(rowSelect)
          .single();

        if (error || !data) {
          throw new Error(error?.message ?? "No se pudo sobrescribir la nota.");
        }

        const cleanupError = await deleteExtraRemoteEvents(targetDate, existingTarget.id);

        if (cleanupError) {
          throw new Error(cleanupError.message);
        }

        return rowToEvent(data as AgendaEventRow, categories);
      }

      const { data, error } = await supabase
        .from("agenda_events")
        .insert({
          user_id: session.user.id,
          ...makeEventPayload(targetDate, localEvent, categories),
        })
        .select(rowSelect)
        .single();

      if (error || !data) {
        throw new Error(error?.message ?? "No se pudo duplicar la nota.");
      }

      return rowToEvent(data as AgendaEventRow, categories);
    }

    return localEvent;
  }

  async function duplicateEvent() {
    const sourceEvent = selectedEvent;

    if (!sourceEvent) {
      setDuplicateMessage("Selecciona una nota para duplicar.");
      return;
    }

    if (!duplicateUntilDate || duplicateUntilDate <= selectedDate) {
      setDuplicateMessage("Elige una fecha final posterior al dia seleccionado.");
      return;
    }

    if (duplicateMode === "custom-days" && duplicateWeekdays.length === 0) {
      setDuplicateMessage("Elige al menos un dia de la semana.");
      return;
    }

    const targets = buildDuplicateTargets();

    if (targets.length === 0) {
      setDuplicateMessage("No hay fechas disponibles con esa recurrencia.");
      return;
    }

    const occupiedTargets = targets.filter((date) => (events[date] ?? []).length > 0);

    if (occupiedTargets.length > 0) {
      const confirmed = window.confirm(
        `Ya existe una nota en: ${occupiedTargets.map(formatLongDate).join(", ")}. Deseas sobrescribirla?`,
      );

      if (!confirmed) {
        return;
      }
    }

    setDataLoading(true);
    setDuplicateMessage("");

    try {
      const savedEvents: Array<{ date: string; event: CalendarEvent }> = [];

      for (const targetDate of targets) {
        const savedEvent = await saveDuplicateToDate(targetDate, makeDraftForDate(sourceEvent, targetDate));
        savedEvents.push({ date: targetDate, event: savedEvent });
      }

      setEvents((current) =>
        savedEvents.reduce(
          (nextEvents, item) => setSingleEventForDate(nextEvents, item.date, item.event),
          current,
        ),
      );
      setDuplicateMessage(
        targets.length === 1
          ? "Nota duplicada correctamente."
          : `Nota duplicada en ${targets.length} fechas.`,
      );
    } catch (error) {
      setDuplicateMessage(
        `No se pudo duplicar: ${error instanceof Error ? error.message : "intenta otra vez"}`,
      );
    } finally {
      setDataLoading(false);
    }
  }

  async function toggleDone(date: string, eventId: string) {
    const currentEvent = events[date]?.find((event) => event.id === eventId);

    if (!currentEvent) {
      return;
    }

    const nextDone = !currentEvent.done;

    if (supabase && session) {
      const { error } = await supabase
        .from("agenda_events")
        .update({ done: nextDone })
        .eq("id", eventId)
        .eq("user_id", session.user.id);

      if (error) {
        setSyncMessage(`No se pudo actualizar la nota: ${error.message}`);
        return;
      }
    }

    setEvents((current) => updateEventDone(current, date, eventId, nextDone));
  }

  async function deleteEvent(date: string, eventId: string) {
    if (supabase && session) {
      const { error } = await supabase
        .from("agenda_events")
        .delete()
        .eq("id", eventId)
        .eq("user_id", session.user.id);

      if (error) {
        setSyncMessage(`No se pudo eliminar la nota: ${error.message}`);
        return;
      }
    }

    setEvents((current) => removeEventFromDate(current, date, eventId));

    if (date === selectedDate && editingEventId === eventId) {
      setEditingEventId(null);
      setEditorMode("hidden");
      resetNoteForm();
    }
  }

  function startCategoryEdit(category: AgendaCategory) {
    setEditingCategoryId(category.id);
    setCategoryNameDraft(category.name);
    setCategoryColorDraft(category.color);
    setCategoryMessage("");
  }

  function selectCategory(nextCategoryId: string | null) {
    setCategoryId(nextCategoryId);

    if (!nextCategoryId) {
      setEditingCategoryId(null);
      setCategoryMessage("");
      setIsCategoryMenuOpen(false);
      return;
    }

    const nextCategory = categories.find((item) => item.id === nextCategoryId);

    if (nextCategory) {
      startCategoryEdit(nextCategory);
    }
  }

  async function createCategory() {
    const name = makeUniqueCategoryName(categories);
    const localCategory: AgendaCategory = {
      id: crypto.randomUUID(),
      name,
      color: NEW_CATEGORY_COLOR,
    };

    setDataLoading(true);
    setCategoryMessage("");

    if (supabase && session) {
      const { data, error } = await supabase
        .from("agenda_categories")
        .insert({
          user_id: session.user.id,
          name,
          color: NEW_CATEGORY_COLOR,
        })
        .select("id,name,color,updated_at")
        .single();

      setDataLoading(false);

      if (error || !data) {
        setCategoryMessage(`No se pudo crear la categoria: ${error?.message ?? "intenta otra vez"}`);
        return;
      }

      const savedCategory = rowToCategory(data as AgendaCategoryRow);
      setCategories((current) => [...current, savedCategory].sort((a, b) => a.name.localeCompare(b.name)));
      setCategoryId(savedCategory.id);
      startCategoryEdit(savedCategory);
      return;
    }

    setCategories((current) => [...current, localCategory].sort((a, b) => a.name.localeCompare(b.name)));
    setCategoryId(localCategory.id);
    startCategoryEdit(localCategory);
    setDataLoading(false);
  }

  async function saveCategory(nextCategoryId: string) {
    const nextName = categoryNameDraft.trim();
    const nextColor = normalizeHexColor(categoryColorDraft);

    if (!nextName) {
      setCategoryMessage("El nombre de la categoria no puede estar vacio.");
      return;
    }

    if (!nextColor) {
      setCategoryMessage("Usa un color hexadecimal valido, por ejemplo #44d7a8.");
      return;
    }

    if (categoryNameExists(categories, nextName, nextCategoryId)) {
      setCategoryMessage("Ya existe una categoria con ese nombre.");
      return;
    }

    setDataLoading(true);
    setCategoryMessage("");

    if (supabase && session) {
      const { data, error } = await supabase
        .from("agenda_categories")
        .update({ name: nextName, color: nextColor })
        .eq("id", nextCategoryId)
        .eq("user_id", session.user.id)
        .select("id,name,color,updated_at")
        .single();

      if (error || !data) {
        setDataLoading(false);
        setCategoryMessage(`No se pudo guardar la categoria: ${error?.message ?? "intenta otra vez"}`);
        return;
      }

      const savedCategory = rowToCategory(data as AgendaCategoryRow);
      const { error: eventUpdateError } = await supabase
        .from("agenda_events")
        .update({ category: savedCategory.name })
        .eq("category_id", nextCategoryId)
        .eq("user_id", session.user.id);

      setDataLoading(false);

      if (eventUpdateError) {
        setCategoryMessage(`La categoria se guardo, pero no se actualizo en notas antiguas: ${eventUpdateError.message}`);
      }

      setCategories((current) =>
        current
          .map((item) => (item.id === nextCategoryId ? savedCategory : item))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
      setEditingCategoryId(null);
      return;
    }

    setCategories((current) =>
      current
        .map((item) =>
          item.id === nextCategoryId ? { ...item, name: nextName, color: nextColor } : item,
        )
        .sort((a, b) => a.name.localeCompare(b.name)),
    );
    setEditingCategoryId(null);
    setDataLoading(false);
  }

  async function deleteCategory(nextCategoryId: string) {
    setDataLoading(true);
    setCategoryMessage("");

    if (supabase && session) {
      const { error: updateError } = await supabase
        .from("agenda_events")
        .update({ category_id: null, category: CATEGORY_NAME_FALLBACK })
        .eq("category_id", nextCategoryId)
        .eq("user_id", session.user.id);

      if (updateError) {
        setDataLoading(false);
        setCategoryMessage(`No se pudo limpiar la categoria en tus notas: ${updateError.message}`);
        return;
      }

      const { error: deleteError } = await supabase
        .from("agenda_categories")
        .delete()
        .eq("id", nextCategoryId)
        .eq("user_id", session.user.id);

      setDataLoading(false);

      if (deleteError) {
        setCategoryMessage(`No se pudo eliminar la categoria: ${deleteError.message}`);
        return;
      }
    } else {
      setDataLoading(false);
    }

    setCategories((current) => current.filter((item) => item.id !== nextCategoryId));
    setEvents((current) => clearCategoryFromEvents(current, nextCategoryId));
    setCategoryId((current) => (current === nextCategoryId ? null : current));
    setEditingCategoryId(null);
  }

  function renderCategoryPicker() {
    return (
      <div className="field-label category-field">
        <span>Categoria</span>
        <div className="category-picker">
          <button
            className="category-picker-button"
            type="button"
            onClick={() => setIsCategoryMenuOpen((current) => !current)}
          >
            <span className="category-color-bar" style={categoryStyle(selectedCategory)} />
            <span className="category-picker-name">{selectedCategory.name}</span>
            <span className="category-picker-caret" aria-hidden="true">
              {isCategoryMenuOpen ? "^" : "v"}
            </span>
          </button>

          {isCategoryMenuOpen ? (
            <div className="category-menu">
              <button
                className="category-option"
                data-active={categoryId === null}
                type="button"
                onClick={() => selectCategory(null)}
              >
                <span className="category-color-bar" style={categoryStyle(UNCATEGORIZED_CATEGORY)} />
                <span>{UNCATEGORIZED_CATEGORY.name}</span>
              </button>

              {categories.map((item) => {
                const isEditingCategory = editingCategoryId === item.id;

                return (
                  <div className="category-option-shell" key={item.id}>
                    <button
                      className="category-option"
                      data-active={categoryId === item.id}
                      type="button"
                      onClick={() => selectCategory(item.id)}
                    >
                      <span className="category-color-bar" style={categoryStyle(item)} />
                      <span>{item.name}</span>
                    </button>

                    {isEditingCategory ? (
                      <div className="category-editor">
                        <input
                          className="field-input category-name-input"
                          value={categoryNameDraft}
                          onChange={(event) => setCategoryNameDraft(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              void saveCategory(item.id);
                            }
                          }}
                          aria-label="Nombre de categoria"
                        />
                        <input
                          className="category-color-input"
                          type="color"
                          value={categoryColorDraft}
                          onChange={(event) => setCategoryColorDraft(event.target.value)}
                          aria-label="Color de categoria"
                        />
                        <button
                          className="small-button"
                          disabled={dataLoading}
                          type="button"
                          onClick={() => saveCategory(item.id)}
                        >
                          Guardar
                        </button>
                        <button
                          className="danger-button compact-action"
                          disabled={dataLoading}
                          type="button"
                          onClick={() => deleteCategory(item.id)}
                        >
                          Eliminar
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              })}

              <button
                className="category-new-button"
                disabled={dataLoading}
                type="button"
                onClick={createCategory}
              >
                Nueva categoria
              </button>
            </div>
          ) : null}
        </div>
        {categoryMessage ? <span className="category-message">{categoryMessage}</span> : null}
      </div>
    );
  }

  function renderCategoryChip(nextCategoryId: string | null) {
    const item = getCategoryDisplay(categories, nextCategoryId);

    return (
      <span className="category-chip" style={categoryStyle(item)}>
        {item.name}
      </span>
    );
  }

  function renderEventDot(calendarEvent: CalendarEvent) {
    const item = getCategoryDisplay(categories, calendarEvent.categoryId);

    return <span className="event-dot" key={calendarEvent.id} style={categoryStyle(item)} />;
  }

  function renderNoteForm() {
    return (
      <form className="mt-4 flex flex-col gap-4" onSubmit={saveEvent}>
        <label className="field-label">
          Titulo
          <input
            autoFocus
            className="field-input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Reunion, clase, tarea..."
            required
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="field-label">
            Hora
            <input
              className="field-input"
              type="time"
              value={time}
              onChange={(event) => {
                setTime(event.target.value);

                if (hasReminder && !reminderAt) {
                  setReminderAt(defaultReminderAt(selectedDate, event.target.value));
                }
              }}
            />
          </label>

          {renderCategoryPicker()}
        </div>

        <label className="field-label">
          Notas
          <textarea
            className="field-input min-h-28 resize-y"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Detalles, lugar, pendientes..."
          />
        </label>

        <label className="toggle-row">
          <input
            checked={hasReminder}
            className="h-4 w-4 accent-[#44d7a8]"
            type="checkbox"
            onChange={(event) => {
              const checked = event.target.checked;
              setHasReminder(checked);

              if (checked && !reminderAt) {
                setReminderAt(defaultReminderAt(selectedDate, time));
              }
            }}
          />
          <span>Activar recordatorio</span>
        </label>

        {hasReminder ? (
          <label className="field-label">
            Fecha y hora de aviso
            <input
              className="field-input"
              type="datetime-local"
              value={reminderAt}
              onChange={(event) => setReminderAt(event.target.value)}
              required
            />
          </label>
        ) : null}

        <div className="note-action-row">
          <button className="primary-button" disabled={dataLoading} type="submit">
            {dataLoading
              ? "Guardando..."
              : editorMode === "edit" && selectedEvent
                ? "Guardar cambios"
                : "Guardar nota"}
          </button>
          <button className="secondary-button" type="button" onClick={cancelEditor}>
            Cancelar
          </button>
        </div>
      </form>
    );
  }

  if (supabase && isMounted && !session) {
    return (
      <main className="min-h-screen bg-[#10100f] text-[#f4f1ea]">
        <section className="mx-auto grid min-h-screen w-full max-w-5xl items-center gap-6 px-4 py-8 md:grid-cols-[1fr_0.9fr]">
          <section className="app-shell p-6 sm:p-8">
            <p className="eyebrow">Agenda web</p>
            <h1 className="mt-2 text-3xl font-bold text-[#fffaf0] sm:text-4xl">
              Entra a tu calendario
            </h1>
            <p className="mt-3 text-sm leading-6 text-[#a7a29a]">
              Usa tu correo para recibir un enlace de acceso. Despues podras abrir la agenda
              desde tu PC, celular o cualquier navegador.
            </p>

            <form className="mt-6 flex flex-col gap-4" onSubmit={signInWithEmail}>
              <label className="field-label">
                Correo
                <input
                  className="field-input"
                  type="email"
                  value={authEmail}
                  onChange={(event) => setAuthEmail(event.target.value)}
                  placeholder="tu-correo@ejemplo.com"
                  required
                />
              </label>

              <button className="primary-button" disabled={authLoading} type="submit">
                {authLoading ? "Enviando..." : "Enviar enlace de acceso"}
              </button>
            </form>

            {authMessage ? <p className="sync-message mt-4">{authMessage}</p> : null}
          </section>

          <aside className="app-shell p-6">
            <h2 className="text-xl font-bold text-[#fffaf0]">Que falta configurar</h2>
            <p className="mt-3 text-sm leading-6 text-[#a7a29a]">
              En Supabase debes crear la tabla con el archivo SQL incluido y agregar tu dominio de
              Vercel en Auth. En Vercel debes poner las mismas variables publicas de Supabase.
            </p>
            <div className="mt-5 rounded-lg border border-[#34312b] bg-[#151411] p-4 text-sm text-[#c7c1b6]">
              <p className="font-bold text-[#ffd166]">Variables necesarias</p>
              <p className="mt-2 font-mono text-xs">NEXT_PUBLIC_SUPABASE_URL</p>
              <p className="mt-1 font-mono text-xs">NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</p>
            </div>
          </aside>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#10100f] text-[#f4f1ea]">
      <section className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <header className="app-shell flex flex-col gap-5 px-5 py-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="eyebrow">Agenda web</p>
            {isEditingCalendarName ? (
              <form className="calendar-title-form mt-2" onSubmit={saveCalendarName}>
                <input
                  className="calendar-name-input"
                  value={calendarNameDraft}
                  onChange={(event) => setCalendarNameDraft(event.target.value)}
                  placeholder={DEFAULT_CALENDAR_NAME}
                  autoFocus
                />
                <button className="small-button" type="submit">
                  Guardar
                </button>
                <button
                  className="small-button"
                  type="button"
                  onClick={() => {
                    setCalendarNameDraft(calendarName);
                    setIsEditingCalendarName(false);
                  }}
                >
                  Cancelar
                </button>
              </form>
            ) : (
              <div className="calendar-title-row mt-1">
                <h1 className="text-3xl font-bold text-[#fffaf0] sm:text-4xl">
                  {calendarName}
                </h1>
                <button
                  className="small-button"
                  type="button"
                  onClick={() => setIsEditingCalendarName(true)}
                >
                  Editar nombre
                </button>
              </div>
            )}
            <p className="mt-2 text-sm text-[#a7a29a]">
              Dia seleccionado: {formatLongDate(selectedDate)}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="status-pill">
              {supabase
                ? dataLoading
                  ? "Sincronizando..."
                  : `Nube: ${session?.user.email ?? "conectado"}`
                : "Modo local"}
            </span>
            {supabase && session ? (
              <button className="small-button" type="button" onClick={signOut}>
                Salir
              </button>
            ) : null}
          </div>
          {syncMessage ? <p className="sync-message lg:max-w-sm">{syncMessage}</p> : null}
        </header>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(340px,0.9fr)]">
          <section className="app-shell overflow-hidden">
            <div className="flex flex-col gap-4 border-b border-[#2b2926] px-4 py-4 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <h2 className="text-2xl font-bold capitalize text-[#fffaf0]">
                  {viewMode === "month" ? formatMonth(monthDate) : `Semana ${weekRange}`}
                </h2>
                <p className="text-sm text-[#a7a29a]">
                  {viewMode === "month"
                    ? "Selecciona un dia para editar su nota."
                    : "Revisa tus notas de la semana seleccionada."}
                </p>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="view-switch" aria-label="Cambiar vista">
                  <button
                    data-active={viewMode === "month"}
                    type="button"
                    onClick={() => setViewMode("month")}
                  >
                    Mensual
                  </button>
                  <button
                    data-active={viewMode === "week"}
                    type="button"
                    onClick={() => setViewMode("week")}
                  >
                    Semanal
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    className="icon-button"
                    type="button"
                    onClick={() => changePeriod(-1)}
                    aria-label={viewMode === "month" ? "Mes anterior" : "Semana anterior"}
                  >
                    &lsaquo;
                  </button>
                  <button className="secondary-button" type="button" onClick={goToToday}>
                    Hoy
                  </button>
                  <button
                    className="icon-button"
                    type="button"
                    onClick={() => changePeriod(1)}
                    aria-label={viewMode === "month" ? "Mes siguiente" : "Semana siguiente"}
                  >
                    &rsaquo;
                  </button>
                </div>
              </div>
            </div>

            {viewMode === "month" ? (
              <>
                <div className="grid grid-cols-7 border-b border-[#2b2926] bg-[#161512] text-center text-xs font-bold uppercase tracking-[0.12em] text-[#928c83]">
                  {weekdays.map((day) => (
                    <div className="px-2 py-3" key={day}>
                      {day}
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-7">
                  {monthDays.map((date) => {
                    const key = toDateKey(date);
                    const isCurrentMonth = date.getMonth() === monthDate.getMonth();
                    const isSelected = key === selectedDate;
                    const isToday = key === todayKey;
                    const dayEvents = events[key] ?? [];

                    return (
                      <button
                        className={[
                          "calendar-day",
                          isSelected ? "calendar-day-selected" : "",
                          !isCurrentMonth ? "calendar-day-muted" : "",
                        ].join(" ")}
                        key={key}
                        type="button"
                        onClick={() => selectDate(date)}
                      >
                        <span className={isToday ? "today-pill" : ""}>{date.getDate()}</span>
                        {dayEvents.length > 0 ? (
                          <span className="day-note-mark">
                            {dayEvents.slice(0, 3).map(renderEventDot)}
                            {dayEvents.some((dayEvent) => dayEvent.hasReminder) ? (
                              <span className="reminder-dot" />
                            ) : null}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="week-grid">
                {weekDays.map((date, index) => {
                  const key = toDateKey(date);
                  const dayEvents = events[key] ?? [];
                  const isSelected = key === selectedDate;
                  const isToday = key === todayKey;

                  return (
                    <section className="week-column" data-active={isSelected} key={key}>
                      <button className="week-column-header" type="button" onClick={() => selectDate(date)}>
                        <span className="text-xs font-bold uppercase tracking-[0.14em] text-[#928c83]">
                          {weekdays[index]}
                        </span>
                        <span className={isToday ? "today-pill" : "week-day-number"}>
                          {date.getDate()}
                        </span>
                      </button>

                      <div className="flex flex-col gap-2">
                        {dayEvents.length === 0 ? (
                          <p className="empty-state compact">Sin nota</p>
                        ) : (
                          dayEvents.map((calendarEvent) => (
                            <article className="event-card compact" data-done={calendarEvent.done} key={calendarEvent.id}>
                              <div className="min-w-0">
                                <p className="truncate font-bold text-[#fffaf0]">{calendarEvent.title}</p>
                                <p className="text-xs font-semibold text-[#a7a29a]">{calendarEvent.time}</p>
                                {calendarEvent.hasReminder && calendarEvent.reminderAt ? (
                                  <p className="mt-1 text-xs font-semibold text-[#ffd166]">
                                    Aviso {formatReminder(calendarEvent.reminderAt)}
                                  </p>
                                ) : null}
                                <div className="week-note-footer">
                                  {renderCategoryChip(calendarEvent.categoryId)}
                                  <button
                                    className="success-button compact-action"
                                    data-active={calendarEvent.done}
                                    type="button"
                                    onClick={() => toggleDone(key, calendarEvent.id)}
                                  >
                                    Realizado
                                  </button>
                                </div>
                              </div>
                            </article>
                          ))
                        )}
                      </div>
                    </section>
                  );
                })}
              </div>
            )}
          </section>

          <aside className="flex flex-col gap-6">
            <section className="app-shell p-5">
              <p className="eyebrow">{formatLongDate(selectedDate)}</p>
              <h2 className="mt-1 text-2xl font-bold text-[#fffaf0]">Notas del dia</h2>

              <div className="mt-4 flex flex-col gap-3">
                {selectedEvents.length === 0 ? (
                  <p className="empty-state">No hay notas guardadas para este dia.</p>
                ) : (
                  selectedEvents.map((calendarEvent) => {
                    const isSelectedNote = calendarEvent.id === editingEventId;
                    const isEditingNote = editorMode === "edit" && isSelectedNote;

                    return (
                      <article
                        className="event-card saved-note-card"
                        data-done={calendarEvent.done}
                        data-selected={isSelectedNote}
                        key={calendarEvent.id}
                      >
                        {isEditingNote ? (
                          <>
                            <div className="saved-note-edit-header">
                              <div className="saved-note-actions horizontal">
                                <button
                                  className="success-button"
                                  data-active={calendarEvent.done}
                                  type="button"
                                  onClick={() => toggleDone(selectedDate, calendarEvent.id)}
                                >
                                  Realizado
                                </button>
                                <button
                                  className="danger-button"
                                  type="button"
                                  onClick={() => deleteEvent(selectedDate, calendarEvent.id)}
                                >
                                  Eliminar
                                </button>
                              </div>
                            </div>

                            {renderNoteForm()}
                          </>
                        ) : (
                          <div className="saved-note-row">
                            <button
                              className="saved-note-open"
                              type="button"
                              onClick={() => fillEditor(calendarEvent)}
                            >
                              <span className="saved-note-title-row">
                                <span className="saved-note-title">{calendarEvent.title}</span>
                                {renderCategoryChip(calendarEvent.categoryId)}
                              </span>
                              <span className="saved-note-time">{calendarEvent.time}</span>
                              {calendarEvent.hasReminder && calendarEvent.reminderAt ? (
                                <span className="saved-note-reminder">
                                  Aviso {formatReminder(calendarEvent.reminderAt)}
                                </span>
                              ) : null}
                              {calendarEvent.notes ? (
                                <span className="saved-note-text">{calendarEvent.notes}</span>
                              ) : null}
                            </button>
                            <div className="saved-note-actions">
                              <button
                                className="success-button"
                                data-active={calendarEvent.done}
                                type="button"
                                onClick={() => toggleDone(selectedDate, calendarEvent.id)}
                              >
                                Realizado
                              </button>
                              <button
                                className="danger-button"
                                type="button"
                                onClick={() => deleteEvent(selectedDate, calendarEvent.id)}
                              >
                                Eliminar
                              </button>
                            </div>
                          </div>
                        )}
                      </article>
                    );
                  })
                )}
              </div>

              <div className="mt-4">
                <button className="secondary-button w-full" type="button" onClick={startNewNote}>
                  Nueva nota
                </button>
              </div>

              {editorMode === "create" ? (
                <div className="editor-panel mt-5">
                  <h3 className="text-lg font-bold text-[#fffaf0]">Nueva nota</h3>
                  {renderNoteForm()}
                </div>
              ) : null}
            </section>

            <section className="app-shell p-5">
              <h2 className="text-xl font-bold text-[#fffaf0]">Duplicar nota</h2>

              <div className="mt-4 flex flex-col gap-4">
                <div className="view-switch view-switch-wide" aria-label="Modo de duplicacion">
                  <button
                    data-active={duplicateMode === "daily"}
                    type="button"
                    onClick={() => setDuplicateMode("daily")}
                  >
                    Diariamente
                  </button>
                  <button
                    data-active={duplicateMode === "custom-days"}
                    type="button"
                    onClick={() => setDuplicateMode("custom-days")}
                  >
                    Dias especificos
                  </button>
                </div>

                {duplicateMode === "custom-days" ? (
                  <div className="field-label">
                    Dias
                    <div className="weekday-grid">
                      {recurrenceWeekdays.map((weekday) => (
                        <button
                          className="weekday-toggle"
                          data-active={duplicateWeekdays.includes(weekday.value)}
                          key={weekday.value}
                          type="button"
                          onClick={() => toggleDuplicateWeekday(weekday.value)}
                        >
                          {weekday.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                <label className="field-label">
                  Hasta la fecha
                  <input
                    className="field-input"
                    min={addDaysToDateKey(selectedDate, 1)}
                    type="date"
                    value={duplicateUntilDate}
                    onChange={(event) => setDuplicateUntilDate(event.target.value)}
                  />
                </label>

                <button
                  className="secondary-button"
                  disabled={
                    !selectedEvent ||
                    dataLoading ||
                    !duplicateUntilDate ||
                    (duplicateMode === "custom-days" && duplicateWeekdays.length === 0)
                  }
                  type="button"
                  onClick={duplicateEvent}
                >
                  Duplicar
                </button>

                {duplicateMessage ? <p className="sync-message">{duplicateMessage}</p> : null}
              </div>
            </section>

          </aside>
        </div>
      </section>
    </main>
  );
}
