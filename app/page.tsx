"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { createClient, type Session } from "@supabase/supabase-js";

type CalendarEvent = {
  id: string;
  title: string;
  time: string;
  category: "Trabajo" | "Personal" | "Estudio" | "Salud";
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
  category: CalendarEvent["category"];
  notes: string | null;
  done: boolean;
  has_reminder: boolean | null;
  reminder_at: string | null;
  updated_at: string | null;
};

type EventsByDate = Record<string, CalendarEvent[]>;
type CalendarView = "month" | "week";
type DuplicateMode = "next-days" | "specific-date";

const STORAGE_KEY = "agenda-web-events";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const weekdays = ["Lun", "Mar", "Mie", "Jue", "Vie", "Sab", "Dom"];
const categories: CalendarEvent["category"][] = [
  "Trabajo",
  "Personal",
  "Estudio",
  "Salud",
];

const rowSelect =
  "id,date,title,event_time,category,notes,done,has_reminder,reminder_at,updated_at";

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

function normalizeCategory(value: unknown): CalendarEvent["category"] {
  return categories.includes(value as CalendarEvent["category"])
    ? (value as CalendarEvent["category"])
    : "Trabajo";
}

function normalizeStoredEvent(event: Partial<CalendarEvent>) {
  const time = typeof event.time === "string" && event.time ? event.time : "09:00";

  return {
    id: typeof event.id === "string" ? event.id : crypto.randomUUID(),
    title: typeof event.title === "string" && event.title ? event.title : "Nota",
    time,
    category: normalizeCategory(event.category),
    notes: typeof event.notes === "string" ? event.notes : "",
    done: Boolean(event.done),
    hasReminder: Boolean(event.hasReminder),
    reminderAt: typeof event.reminderAt === "string" ? event.reminderAt : "",
    updatedAt: typeof event.updatedAt === "string" ? event.updatedAt : undefined,
  };
}

function rowToEvent(row: AgendaEventRow): CalendarEvent {
  return {
    id: row.id,
    title: row.title,
    time: (row.event_time ?? "09:00").slice(0, 5),
    category: row.category,
    notes: row.notes ?? "",
    done: row.done,
    hasReminder: Boolean(row.has_reminder),
    reminderAt: row.reminder_at ? formatDateTimeForInput(new Date(row.reminder_at)) : "",
    updatedAt: row.updated_at ?? undefined,
  };
}

function rowsToEvents(rows: AgendaEventRow[]) {
  return rows.reduce<EventsByDate>((calendarEvents, row) => {
    calendarEvents[row.date] = [...(calendarEvents[row.date] ?? []), rowToEvent(row)].sort((a, b) =>
      a.time.localeCompare(b.time),
    );
    return calendarEvents;
  }, {});
}

function setSingleEventForDate(events: EventsByDate, date: string, event: CalendarEvent) {
  return {
    ...events,
    [date]: [event],
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

function parseLocalEvents(savedEvents: string | null) {
  if (!savedEvents) {
    return {};
  }

  try {
    const parsed = JSON.parse(savedEvents) as Record<string, Partial<CalendarEvent>[]>;

    return Object.entries(parsed).reduce<EventsByDate>((calendarEvents, [date, dayEvents]) => {
      if (Array.isArray(dayEvents)) {
        calendarEvents[date] = dayEvents.map(normalizeStoredEvent).sort((a, b) =>
          a.time.localeCompare(b.time),
        );
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

function makeEventPayload(date: string, draft: EventDraft) {
  return {
    date,
    title: draft.title,
    event_time: draft.time,
    category: draft.category,
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
    category: event.category,
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
  const [session, setSession] = useState<Session | null>(null);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [time, setTime] = useState("09:00");
  const [category, setCategory] = useState<CalendarEvent["category"]>("Trabajo");
  const [notes, setNotes] = useState("");
  const [hasReminder, setHasReminder] = useState(false);
  const [reminderAt, setReminderAt] = useState(defaultReminderAt(todayKey));
  const [duplicateMode, setDuplicateMode] = useState<DuplicateMode>("next-days");
  const [duplicateDays, setDuplicateDays] = useState("1");
  const [duplicateDate, setDuplicateDate] = useState(addDaysToDateKey(todayKey, 1));
  const [duplicateMessage, setDuplicateMessage] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [syncMessage, setSyncMessage] = useState("");
  const [isMounted, setIsMounted] = useState(false);
  const [dataLoading, setDataLoading] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);

  const selectedDateObject = useMemo(() => fromDateKey(selectedDate), [selectedDate]);
  const monthDays = useMemo(() => createMonthDays(monthDate), [monthDate]);
  const weekDays = useMemo(() => createWeekDays(selectedDateObject), [selectedDateObject]);
  const selectedEvents = events[selectedDate] ?? [];
  const selectedEvent = selectedEvents.find((event) => event.id === editingEventId) ?? selectedEvents[0] ?? null;
  const primarySelectedEvent = selectedEvents[0] ?? null;
  const weekRange = `${formatShortDate(weekDays[0])} - ${formatShortDate(weekDays[6])}`;
  const userId = session?.user.id;

  useEffect(() => {
    let ignore = false;

    async function boot() {
      await Promise.resolve();

      if (!supabase) {
        const savedEvents = window.localStorage.getItem(STORAGE_KEY);

        if (!ignore) {
          setEvents(parseLocalEvents(savedEvents));
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
    if (!supabase || !userId) {
      return;
    }

    const client = supabase;
    let ignore = false;

    async function loadEvents() {
      setDataLoading(true);
      setSyncMessage("");

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
        setEvents(rowsToEvents((data ?? []) as AgendaEventRow[]));
      }

      setDataLoading(false);
    }

    void loadEvents();

    return () => {
      ignore = true;
    };
  }, [supabase, userId]);

  useEffect(() => {
    let ignore = false;

    async function syncEditor() {
      await Promise.resolve();

      if (ignore) {
        return;
      }

      if (primarySelectedEvent) {
        setEditingEventId(primarySelectedEvent.id);
        setTitle(primarySelectedEvent.title);
        setTime(primarySelectedEvent.time);
        setCategory(primarySelectedEvent.category);
        setNotes(primarySelectedEvent.notes);
        setHasReminder(primarySelectedEvent.hasReminder);
        setReminderAt(
          primarySelectedEvent.reminderAt || defaultReminderAt(selectedDate, primarySelectedEvent.time),
        );
      } else {
        setEditingEventId(null);
        setTitle("");
        setTime("09:00");
        setCategory("Trabajo");
        setNotes("");
        setHasReminder(false);
        setReminderAt(defaultReminderAt(selectedDate));
      }

      setDuplicateDate(addDaysToDateKey(selectedDate, 1));
      setDuplicateMessage("");
    }

    void syncEditor();

    return () => {
      ignore = true;
    };
  }, [primarySelectedEvent, selectedDate]);

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

  function fillEditor(calendarEvent: CalendarEvent) {
    setEditingEventId(calendarEvent.id);
    setTitle(calendarEvent.title);
    setTime(calendarEvent.time);
    setCategory(calendarEvent.category);
    setNotes(calendarEvent.notes);
    setHasReminder(calendarEvent.hasReminder);
    setReminderAt(calendarEvent.reminderAt || defaultReminderAt(selectedDate, calendarEvent.time));
  }

  function buildDraft(): EventDraft | null {
    if (!title.trim()) {
      return null;
    }

    return {
      title: title.trim(),
      time,
      category,
      notes: notes.trim(),
      done: selectedEvent?.done ?? false,
      hasReminder,
      reminderAt: hasReminder ? reminderAt || defaultReminderAt(selectedDate, time) : "",
    };
  }

  function buildDuplicateTargets() {
    if (duplicateMode === "specific-date") {
      return duplicateDate && duplicateDate !== selectedDate ? [duplicateDate] : [];
    }

    const days = Math.min(30, Math.max(1, Number.parseInt(duplicateDays, 10) || 1));
    return Array.from({ length: days }, (_, index) => addDaysToDateKey(selectedDate, index + 1));
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

    const draft = buildDraft();

    if (!draft) {
      return;
    }

    const existingEvent = selectedEvent ?? primarySelectedEvent;
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
          .update(makeEventPayload(selectedDate, localEvent))
          .eq("id", existingEvent.id)
          .eq("user_id", session.user.id)
          .select(rowSelect)
          .single();

        if (error || !data) {
          setDataLoading(false);
          setSyncMessage(`No se pudo actualizar la nota: ${error?.message ?? "intenta otra vez"}`);
          return;
        }

        const cleanupError = await deleteExtraRemoteEvents(selectedDate, existingEvent.id);

        if (cleanupError) {
          setSyncMessage(`La nota se guardo, pero no se limpiaron duplicados: ${cleanupError.message}`);
        }

        const savedEvent = rowToEvent(data as AgendaEventRow);
        setEvents((current) => setSingleEventForDate(current, selectedDate, savedEvent));
        setEditingEventId(savedEvent.id);
        setDataLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from("agenda_events")
        .insert({
          user_id: session.user.id,
          ...makeEventPayload(selectedDate, localEvent),
        })
        .select(rowSelect)
        .single();

      setDataLoading(false);

      if (error || !data) {
        setSyncMessage(`No se pudo guardar la nota: ${error?.message ?? "intenta otra vez"}`);
        return;
      }

      const savedEvent = rowToEvent(data as AgendaEventRow);
      setEvents((current) => setSingleEventForDate(current, selectedDate, savedEvent));
      setEditingEventId(savedEvent.id);
      return;
    }

    setEvents((current) => setSingleEventForDate(current, selectedDate, localEvent));
    setEditingEventId(localEvent.id);
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
          .update(makeEventPayload(targetDate, localEvent))
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

        return rowToEvent(data as AgendaEventRow);
      }

      const { data, error } = await supabase
        .from("agenda_events")
        .insert({
          user_id: session.user.id,
          ...makeEventPayload(targetDate, localEvent),
        })
        .select(rowSelect)
        .single();

      if (error || !data) {
        throw new Error(error?.message ?? "No se pudo duplicar la nota.");
      }

      return rowToEvent(data as AgendaEventRow);
    }

    return localEvent;
  }

  async function duplicateEvent() {
    const sourceEvent = selectedEvent ?? primarySelectedEvent;

    if (!sourceEvent) {
      return;
    }

    const targets = buildDuplicateTargets();

    if (targets.length === 0) {
      setDuplicateMessage("Elige una fecha distinta para duplicar.");
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
      setDuplicateMessage("Nota duplicada correctamente.");
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
            <h1 className="mt-1 text-3xl font-bold text-[#fffaf0] sm:text-4xl">
              Calendario personal
            </h1>
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
                    const dayEvent = events[key]?.[0] ?? null;

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
                        {dayEvent ? (
                          <span className="day-note-mark">
                            <span className="event-dot" data-category={dayEvent.category} />
                            {dayEvent.hasReminder ? <span className="reminder-dot" /> : null}
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
                              <div className="flex items-start gap-2">
                                <input
                                  aria-label="Marcar como completado"
                                  checked={calendarEvent.done}
                                  className="mt-1 h-4 w-4 accent-[#44d7a8]"
                                  type="checkbox"
                                  onChange={() => toggleDone(key, calendarEvent.id)}
                                />
                                <div className="min-w-0 flex-1">
                                  <p className="truncate font-bold text-[#fffaf0]">{calendarEvent.title}</p>
                                  <p className="text-xs font-semibold text-[#a7a29a]">{calendarEvent.time}</p>
                                  {calendarEvent.hasReminder && calendarEvent.reminderAt ? (
                                    <p className="mt-1 text-xs font-semibold text-[#ffd166]">
                                      Aviso {formatReminder(calendarEvent.reminderAt)}
                                    </p>
                                  ) : null}
                                  <span className="category-chip mt-2 inline-flex" data-category={calendarEvent.category}>
                                    {calendarEvent.category}
                                  </span>
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
              <h2 className="mt-1 text-2xl font-bold text-[#fffaf0]">
                {selectedEvent ? "Editar nota" : "Nueva nota"}
              </h2>

              <form className="mt-5 flex flex-col gap-4" onSubmit={saveEvent}>
                <label className="field-label">
                  Titulo
                  <input
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

                  <label className="field-label">
                    Categoria
                    <select
                      className="field-input"
                      value={category}
                      onChange={(event) => setCategory(event.target.value as CalendarEvent["category"])}
                    >
                      {categories.map((item) => (
                        <option key={item}>{item}</option>
                      ))}
                    </select>
                  </label>
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

                <button className="primary-button" disabled={dataLoading} type="submit">
                  {dataLoading ? "Guardando..." : selectedEvent ? "Guardar cambios" : "Guardar nota"}
                </button>
              </form>
            </section>

            <section className="app-shell p-5">
              <h2 className="text-xl font-bold text-[#fffaf0]">Duplicar nota</h2>

              <div className="mt-4 flex flex-col gap-4">
                <div className="view-switch view-switch-wide" aria-label="Modo de duplicacion">
                  <button
                    data-active={duplicateMode === "next-days"}
                    type="button"
                    onClick={() => setDuplicateMode("next-days")}
                  >
                    Dias siguientes
                  </button>
                  <button
                    data-active={duplicateMode === "specific-date"}
                    type="button"
                    onClick={() => setDuplicateMode("specific-date")}
                  >
                    Fecha exacta
                  </button>
                </div>

                {duplicateMode === "next-days" ? (
                  <label className="field-label">
                    Dias a copiar
                    <input
                      className="field-input"
                      min="1"
                      max="30"
                      type="number"
                      value={duplicateDays}
                      onChange={(event) => setDuplicateDays(event.target.value)}
                    />
                  </label>
                ) : (
                  <label className="field-label">
                    Fecha destino
                    <input
                      className="field-input"
                      type="date"
                      value={duplicateDate}
                      onChange={(event) => setDuplicateDate(event.target.value)}
                    />
                  </label>
                )}

                <button
                  className="secondary-button"
                  disabled={!selectedEvent || dataLoading}
                  type="button"
                  onClick={duplicateEvent}
                >
                  Duplicar
                </button>

                {duplicateMessage ? <p className="sync-message">{duplicateMessage}</p> : null}
              </div>
            </section>

            <section className="app-shell p-5">
              <h2 className="text-xl font-bold text-[#fffaf0]">Notas guardadas</h2>

              <div className="mt-4 flex flex-col gap-3">
                {selectedEvents.length === 0 ? (
                  <p className="empty-state">No hay nota para este dia.</p>
                ) : (
                  selectedEvents.map((calendarEvent) => (
                    <article className="event-card" data-done={calendarEvent.done} key={calendarEvent.id}>
                      <div className="flex items-start gap-3">
                        <input
                          aria-label="Marcar como completado"
                          checked={calendarEvent.done}
                          className="mt-1 h-4 w-4 accent-[#44d7a8]"
                          type="checkbox"
                          onChange={() => toggleDone(selectedDate, calendarEvent.id)}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-bold text-[#fffaf0]">{calendarEvent.title}</p>
                            <span className="category-chip" data-category={calendarEvent.category}>
                              {calendarEvent.category}
                            </span>
                          </div>
                          <p className="mt-1 text-sm font-semibold text-[#a7a29a]">{calendarEvent.time}</p>
                          {calendarEvent.hasReminder && calendarEvent.reminderAt ? (
                            <p className="mt-1 text-sm font-semibold text-[#ffd166]">
                              Aviso {formatReminder(calendarEvent.reminderAt)}
                            </p>
                          ) : null}
                          {calendarEvent.notes ? (
                            <p className="mt-2 text-sm leading-6 text-[#c7c1b6]">{calendarEvent.notes}</p>
                          ) : null}

                          <div className="mt-3 flex flex-wrap gap-2">
                            <button
                              className="small-button"
                              type="button"
                              onClick={() => fillEditor(calendarEvent)}
                            >
                              Editar
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
                      </div>
                    </article>
                  ))
                )}
              </div>
            </section>
          </aside>
        </div>
      </section>
    </main>
  );
}
