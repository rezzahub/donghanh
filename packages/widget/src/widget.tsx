import { useBridge, useToolResult } from "./hooks";
import {
  Actions,
  type BriefStructured,
  Display,
  Form,
  Layout,
  WidgetStyles,
} from "./renderers";

export interface DongHanhWidgetProps {
  appName?: string;
  appVersion?: string;
  /** Override default CSS. */
  css?: string;
  /** Loading state while bridge connects or awaits first tool-result. */
  fallback?: React.ReactNode;
}

/** Default widget that renders a donghanh Brief from structuredContent. */
export function DongHanhWidget(props: DongHanhWidgetProps = {}) {
  const ready = useBridge({
    name: props.appName ?? "donghanh-widget",
    version: props.appVersion ?? "0.1.0",
  });
  const result = useToolResult<BriefStructured & Record<string, unknown>>();

  if (!ready || !result) {
    return (
      <>
        <WidgetStyles css={props.css} />
        <Layout>
          {props.fallback ?? <p className="dh-muted">Loading…</p>}
        </Layout>
      </>
    );
  }

  const sc = result.structuredContent ?? {};
  const display = sc.display;
  const actions = sc.actions;
  const form = sc.form;

  return (
    <>
      <WidgetStyles css={props.css} />
      <Layout>
        {display !== undefined && <Display data={display} />}
        {form && <Form descriptor={form} />}
        {actions && <Actions items={actions} />}
      </Layout>
    </>
  );
}
