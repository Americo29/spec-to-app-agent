import type { Task } from '../types';

/**
 * Dry-run fixtures: a coherent mock run with zero API calls.
 *
 * The domain is deliberately neutral (widgets, not cars) so these can never be mistaken for
 * hardcoded knowledge of the real specification. Their job is to exercise the pipeline's
 * shape — dependency-ordered generation, a failing validation pass, a repair — not to model
 * the target app.
 *
 * Coherence contract:
 * - every task in MOCK_PLAN has an entry in MOCK_FILES
 * - the file contents import each other exactly as MOCK_PLAN's dependsOn graph says
 * - BROKEN_FILE fails typecheck on the first validation pass; MOCK_REPAIRS serves the
 *   corrected version on the repair call
 */

export const MOCK_PLAN: Task[] = [
  {
    id: 'widget-data',
    file: 'src/mocks/widgetData.ts',
    description:
      'Static widget fixture data and its async accessor. Exports interface Widget { id: string; label: string; weight: number }, const WIDGETS: Widget[], and fetchWidgets(): Promise<Widget[]>.',
    type: 'mock',
    dependsOn: [],
  },
  {
    id: 'use-widgets-hook',
    file: 'src/hooks/useWidgets.ts',
    description:
      'Data hook over the widget source. Exports interface UseWidgetsResult { widgets: Widget[]; loading: boolean } and useWidgets(): UseWidgetsResult.',
    type: 'hook',
    dependsOn: ['widget-data'],
  },
  {
    id: 'widget-list-component',
    file: 'src/components/WidgetList.tsx',
    description:
      'Renders the widgets from useWidgets with a loading state. Exports WidgetList(): JSX.Element.',
    type: 'component',
    dependsOn: ['use-widgets-hook'],
  },
  {
    id: 'widget-list-test',
    file: 'src/__tests__/WidgetList.test.tsx',
    description:
      'Behavioural test for WidgetList: asserts every fixture label reaches the DOM after the async load.',
    type: 'test',
    dependsOn: ['widget-list-component'],
  },
];

const WIDGET_DATA = `export interface Widget {
  id: string;
  label: string;
  weight: number;
}

export const WIDGETS: Widget[] = [
  { id: 'w1', label: 'Alpha', weight: 3 },
  { id: 'w2', label: 'Beta', weight: 7 },
  { id: 'w3', label: 'Gamma', weight: 5 },
];

export function fetchWidgets(): Promise<Widget[]> {
  return Promise.resolve(WIDGETS);
}
`;

const USE_WIDGETS = `import { useEffect, useState } from 'react';
import { fetchWidgets, type Widget } from '../mocks/widgetData';

export interface UseWidgetsResult {
  widgets: Widget[];
  loading: boolean;
}

export function useWidgets(): UseWidgetsResult {
  const [widgets, setWidgets] = useState<Widget[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void fetchWidgets().then((result) => {
      if (!active) return;
      setWidgets(result);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  return { widgets, loading };
}
`;

/** Intentionally broken: \`widgets.length\` is a number, annotated as a string. */
const WIDGET_LIST_BROKEN = `import { useWidgets } from '../hooks/useWidgets';

export function WidgetList() {
  const { widgets, loading } = useWidgets();
  const total: string = widgets.length;

  if (loading) return <p>Loading widgets…</p>;

  return (
    <ul aria-label="widgets">
      {widgets.map((widget) => (
        <li key={widget.id}>
          {widget.label} ({widget.weight})
        </li>
      ))}
      <li>total: {total}</li>
    </ul>
  );
}
`;

/** The minimal fix: drop the wrong annotation, keep the exported API identical. */
const WIDGET_LIST_FIXED = `import { useWidgets } from '../hooks/useWidgets';

export function WidgetList() {
  const { widgets, loading } = useWidgets();
  const total = widgets.length;

  if (loading) return <p>Loading widgets…</p>;

  return (
    <ul aria-label="widgets">
      {widgets.map((widget) => (
        <li key={widget.id}>
          {widget.label} ({widget.weight})
        </li>
      ))}
      <li>total: {total}</li>
    </ul>
  );
}
`;

const WIDGET_LIST_TEST = `import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { WidgetList } from '../components/WidgetList';

describe('WidgetList', () => {
  it('renders every widget from the mock source once loading resolves', async () => {
    render(<WidgetList />);

    expect(await screen.findByText(/Alpha/)).toBeInTheDocument();
    expect(screen.getByText(/Beta/)).toBeInTheDocument();
    expect(screen.getByText(/Gamma/)).toBeInTheDocument();
    expect(screen.getByText('total: 3')).toBeInTheDocument();
  });
});
`;

/** Served on the generator call, keyed by the task's file path. */
export const MOCK_FILES: Record<string, string> = {
  'src/mocks/widgetData.ts': WIDGET_DATA,
  'src/hooks/useWidgets.ts': USE_WIDGETS,
  'src/components/WidgetList.tsx': WIDGET_LIST_BROKEN,
  'src/__tests__/WidgetList.test.tsx': WIDGET_LIST_TEST,
};

/** Served on the repair call, keyed by the same file path. */
export const MOCK_REPAIRS: Record<string, string> = {
  'src/components/WidgetList.tsx': WIDGET_LIST_FIXED,
};

/** The file the fixture set breaks on purpose, so the repair loop is exercised. */
export const BROKEN_FILE = 'src/components/WidgetList.tsx';
