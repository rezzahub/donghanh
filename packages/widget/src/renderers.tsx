import type { CSSProperties, FormEvent, ReactNode } from "react";
import { useState } from "react";
import { useCallTool } from "./hooks";

/** Shape of structuredContent produced by renderForChatGpt in @donghanh/hono. */
export interface BriefStructured {
  display?: unknown;
  actions?: Array<{
    id: string;
    type: string;
    description: string;
    variables?: Record<string, unknown>;
    $variables?: string;
    input?: object;
  }>;
  form?: FormDescriptor;
}

export interface FormDescriptor {
  operation: string;
  fields: Array<{
    name: string;
    type: string;
    label?: string;
    required?: boolean;
  }>;
}

// ---------- Display ----------

export function Display({ data }: { data: unknown }) {
  if (data == null) return null;
  if (typeof data === "string") return <p className="dh-text">{data}</p>;
  if (typeof data === "number" || typeof data === "boolean")
    return <p className="dh-text">{String(data)}</p>;
  if (Array.isArray(data)) return <DisplayList items={data} />;
  if (typeof data === "object")
    return <DisplayRecord record={data as Record<string, unknown>} />;
  return null;
}

function DisplayList({ items }: { items: unknown[] }) {
  if (items.length === 0) return <p className="dh-muted">No items.</p>;
  const allPrimitive = items.every((i) => i == null || typeof i !== "object");
  if (allPrimitive) {
    return (
      <ul className="dh-list">
        {items.map((item, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: items may not have stable ids
          <li key={i}>{String(item)}</li>
        ))}
      </ul>
    );
  }
  return (
    <div className="dh-rows">
      {items.map((item, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: items may not have stable ids
        <Display key={i} data={item} />
      ))}
    </div>
  );
}

function DisplayRecord({ record }: { record: Record<string, unknown> }) {
  const entries = Object.entries(record);
  return (
    <dl className="dh-record">
      {entries.map(([k, v]) => (
        <div key={k} className="dh-row">
          <dt>{k}</dt>
          <dd>
            {typeof v === "object" && v !== null ? (
              <Display data={v} />
            ) : (
              String(v ?? "")
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

// ---------- Actions ----------

export function Actions({
  items,
  onCall,
}: {
  items?: BriefStructured["actions"];
  onCall?: (id: string, vars?: Record<string, unknown>) => void;
}) {
  const callTool = useCallTool();
  if (!items || items.length === 0) return null;
  const handle = async (id: string, vars?: Record<string, unknown>) => {
    if (onCall) return onCall(id, vars);
    await callTool(id, vars);
  };
  return (
    <div className="dh-actions">
      {items.map((a) => (
        <button
          key={a.id}
          type="button"
          className="dh-action"
          onClick={() => handle(a.id, a.variables)}
        >
          {a.description}
        </button>
      ))}
    </div>
  );
}

// ---------- Form ----------

export function Form({
  descriptor,
  onSubmit,
}: {
  descriptor?: FormDescriptor;
  onSubmit?: (op: string, values: Record<string, unknown>) => void;
}) {
  const callTool = useCallTool();
  const [values, setValues] = useState<Record<string, string>>({});
  if (!descriptor) return null;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (onSubmit) return onSubmit(descriptor.operation, values);
    await callTool(descriptor.operation, values);
  };
  return (
    <form className="dh-form" onSubmit={submit}>
      {descriptor.fields.map((f) => (
        <label key={f.name} className="dh-field">
          <span>{f.label ?? f.name}</span>
          <input
            name={f.name}
            type={f.type === "number" ? "number" : "text"}
            required={f.required}
            value={values[f.name] ?? ""}
            onChange={(e) =>
              setValues((prev) => ({ ...prev, [f.name]: e.target.value }))
            }
          />
        </label>
      ))}
      <button type="submit" className="dh-submit">
        Submit
      </button>
    </form>
  );
}

// ---------- Default styles ----------

export const defaultWidgetStyles = `
.dh-root { font-family: system-ui, -apple-system, sans-serif; color: #111; padding: 12px; }
.dh-text { margin: 0 0 8px; }
.dh-muted { color: #6c768a; }
.dh-list { list-style: none; padding: 0; margin: 0 0 8px; display: flex; flex-direction: column; gap: 4px; }
.dh-list li { background: #f2f4fb; padding: 8px 10px; border-radius: 8px; }
.dh-rows { display: flex; flex-direction: column; gap: 8px; margin-bottom: 8px; }
.dh-record { margin: 0 0 8px; display: grid; grid-template-columns: max-content 1fr; gap: 4px 12px; }
.dh-record .dh-row { display: contents; }
.dh-record dt { font-weight: 600; color: #374151; }
.dh-record dd { margin: 0; }
.dh-actions { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0; }
.dh-action { border: 1px solid #cad3e0; background: #fff; padding: 6px 12px; border-radius: 8px; font-size: 0.9rem; cursor: pointer; }
.dh-action:hover { background: #f6f8fb; }
.dh-form { display: flex; flex-direction: column; gap: 8px; }
.dh-field { display: flex; flex-direction: column; gap: 4px; }
.dh-field input { padding: 8px 10px; border: 1px solid #cad3e0; border-radius: 8px; font: inherit; }
.dh-submit { align-self: flex-start; border: none; background: #111bf5; color: #fff; padding: 8px 14px; border-radius: 8px; font-weight: 600; cursor: pointer; }
`.trim();

export function WidgetStyles({ css }: { css?: string }) {
  return (
    <style
      // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted inline CSS
      dangerouslySetInnerHTML={{ __html: css ?? defaultWidgetStyles }}
    />
  );
}

export function Layout({
  children,
  style,
}: {
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div className="dh-root" style={style}>
      {children}
    </div>
  );
}
