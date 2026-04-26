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
};

type AgendaEventRow = {
  id: string;
  date: string;
  title: string;
  event_time: string;
  category: CalendarEvent["category"];
  notes: string | null;
  done: boolean;
};

type EventsByDate = Record<string, CalendarEvent[]>;
type CalendarView = "month" | "week";

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

function getEventsForDays(events: EventsByDate, days: Date[]) {
  return days.flatMap((date) => {
    const key = toDateKey(date);
    return (events[key] ?? []).map((event) => ({ date: key, event }));
  });
}

function rowToEvent(row: AgendaEventRow): CalendarEvent {
  return {
    id: row.id,
    title: row.title,
    time: row.event_time.slice(0, 5),
    category: row.category,
    notes: row.notes ?? "",
    done: row.done,
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

function addEventToDate(events: EventsByDate, date: string, event: CalendarEvent) {
  return {
    ...events,
    [date]: [...(events[date] ?? []), event].sort((a, b) => a.time.localeCompare(b.time)),
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
    return JSON.parse(savedEvents) as EventsByDate;
  } catch {
    return {};
  }
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
  const [title, setTitle] = useState("");
  const [time, setTime] = useState("09:00");
  const [category, setCategory] = useState<CalendarEvent["category"]>("Trabajo");
  const [notes, setNotes] = useState("");
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
  const weekEvents = useMemo(() => getEventsForDays(events, weekDays), [events, weekDays]);
  const completedWeekEvents = weekEvents.filter(({ event }) => event.done).length;
  const activeWeekDays = weekDays.filter((date) => (events[toDateKey(date)] ?? []).length > 0).length;
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
        .select("id,date,title,event_time,category,notes,done")
        .order("date", { ascending: true })
        .order("event_time", { ascending: true });

      if (ignore) {
        return;
      }

      if (error) {
        setSyncMessage(`No se pudieron cargar tus eventos: ${error.message}`);
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

  async function addEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!title.trim()) {
      return;
    }

    const nextEvent: CalendarEvent = {
      id: crypto.randomUUID(),
      title: title.trim(),
      time,
      category,
      notes: notes.trim(),
      done: false,
    };

    if (supabase && session) {
      setDataLoading(true);
      setSyncMessage("");

      const { data, error } = await supabase
        .from("agenda_events")
        .insert({
          user_id: session.user.id,
          date: selectedDate,
          title: nextEvent.title,
          event_time: nextEvent.time,
          category: nextEvent.category,
          notes: nextEvent.notes,
          done: false,
        })
        .select("id,date,title,event_time,category,notes,done")
        .single();

      setDataLoading(false);

      if (error || !data) {
        setSyncMessage(`No se pudo guardar el evento: ${error?.message ?? "intenta otra vez"}`);
        return;
      }

      setEvents((current) => addEventToDate(current, selectedDate, rowToEvent(data as AgendaEventRow)));
      setTitle("");
      setNotes("");
      return;
    }

    setEvents((current) => addEventToDate(current, selectedDate, nextEvent));
    setTitle("");
    setNotes("");
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
        setSyncMessage(`No se pudo actualizar el evento: ${error.message}`);
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
        setSyncMessage(`No se pudo eliminar el evento: ${error.message}`);
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
            <div className="mt-3 flex flex-wrap items-center gap-2">
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
            {syncMessage ? <p className="sync-message mt-3">{syncMessage}</p> : null}
          </div>

          <div className="grid gap-3 sm:grid-cols-[1fr_1.25fr_1fr] lg:min-w-[560px]">
            <div className="stat-card">
              <p className="stat-value text-[#44d7a8]">{selectedEvents.length}</p>
              <p className="stat-label">Eventos del dia</p>
            </div>

            <div className="stat-card">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="stat-value text-[#ffd166]">{weekEvents.length}</p>
                  <p className="stat-label">Semana</p>
                </div>
                <p className="text-right text-xs font-bold text-[#928c83]">{weekRange}</p>
              </div>

              <div className="mt-3 grid grid-cols-7 gap-1.5">
                {weekDays.map((date, index) => {
                  const key = toDateKey(date);
                  const dayEvents = events[key] ?? [];
                  const height = Math.min(36, 8 + dayEvents.length * 9);

                  return (
                    <button
                      className="week-indicator"
                      data-active={key === selectedDate}
                      key={key}
                      title={`${weekdays[index]}: ${dayEvents.length} eventos`}
                      type="button"
                      onClick={() => selectDate(date)}
                    >
                      <span className="week-bar" style={{ height }} />
                      <span>{weekdays[index][0]}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="stat-card">
              <p className="stat-value text-[#9aa7ff]">{completedWeekEvents}</p>
              <p className="stat-label">Listos semana</p>
              <p className="mt-1 text-xs font-semibold text-[#928c83]">
                {activeWeekDays} dias con eventos
              </p>
            </div>
          </div>
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
                    ? "Selecciona un dia para ver o crear eventos."
                    : "Revisa los eventos distribuidos en la semana seleccionada."}
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
                        <span className="mt-auto flex min-h-5 flex-wrap gap-1">
                          {dayEvents.slice(0, 3).map((calendarEvent) => (
                            <span className="event-dot" data-category={calendarEvent.category} key={calendarEvent.id} />
                          ))}
                          {dayEvents.length > 3 ? (
                            <span className="text-[10px] font-semibold text-[#a7a29a]">
                              +{dayEvents.length - 3}
                            </span>
                          ) : null}
                        </span>
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
                        <span className="text-xs font-semibold text-[#a7a29a]">
                          {dayEvents.length} eventos
                        </span>
                      </button>

                      <div className="flex flex-col gap-2">
                        {dayEvents.length === 0 ? (
                          <p className="empty-state compact">Sin eventos</p>
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
              <h2 className="mt-1 text-2xl font-bold text-[#fffaf0]">Nuevo evento</h2>

              <form className="mt-5 flex flex-col gap-4" onSubmit={addEvent}>
                <label className="field-label">
                  Titulo
                  <input
                    className="field-input"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="Reunion, clase, tarea..."
                  />
                </label>

                <div className="grid grid-cols-2 gap-3">
                  <label className="field-label">
                    Hora
                    <input
                      className="field-input"
                      type="time"
                      value={time}
                      onChange={(event) => setTime(event.target.value)}
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

                <button className="primary-button" disabled={dataLoading} type="submit">
                  {dataLoading ? "Guardando..." : "Guardar evento"}
                </button>
              </form>
            </section>

            <section className="app-shell p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-xl font-bold text-[#fffaf0]">Eventos del dia</h2>
                <span className="count-pill">{selectedEvents.length}</span>
              </div>

              <div className="mt-4 flex flex-col gap-3">
                {selectedEvents.length === 0 ? (
                  <p className="empty-state">No hay eventos para este dia.</p>
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
                          {calendarEvent.notes ? (
                            <p className="mt-2 text-sm leading-6 text-[#c7c1b6]">{calendarEvent.notes}</p>
                          ) : null}
                        </div>
                        <button
                          aria-label="Eliminar evento"
                          className="delete-button"
                          type="button"
                          onClick={() => deleteEvent(selectedDate, calendarEvent.id)}
                        >
                          &times;
                        </button>
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
