import { Component, ReactNode } from "react";
import { useLocation } from "react-router-dom";

interface Props {
  routeName: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
  info: string | null;
}

class ErrorBoundaryInner extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): State {
    return { error, info: null };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    this.setState({ info: info?.componentStack ?? null });
    // eslint-disable-next-line no-console
    console.error(`[RouteErrorBoundary:${this.props.routeName}]`, error, info);
  }

  handleReset = () => {
    this.setState({ error: null, info: null });
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    const failingComponent = extractFailingComponent(info);

    return (
      <div className="min-h-[60vh] flex items-center justify-center p-6">
        <div className="max-w-2xl w-full rounded-lg border border-destructive/40 bg-destructive/5 p-6 space-y-4">
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <h2 className="text-lg font-semibold text-destructive">
                화면 렌더링 오류
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                페이지를 표시하는 중 문제가 발생했습니다. 아래 정보를 확인해 주세요.
              </p>
            </div>
          </div>

          <div className="text-sm space-y-2">
            <div>
              <span className="font-medium">페이지:</span>{" "}
              <code className="px-1.5 py-0.5 rounded bg-muted">{this.props.routeName}</code>
            </div>
            {failingComponent && (
              <div>
                <span className="font-medium">실패 컴포넌트:</span>{" "}
                <code className="px-1.5 py-0.5 rounded bg-muted">{failingComponent}</code>
              </div>
            )}
            <div>
              <span className="font-medium">오류 메시지:</span>{" "}
              <span className="text-destructive">{error.message || String(error)}</span>
            </div>
          </div>

          {info && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                상세 스택 보기
              </summary>
              <pre className="mt-2 max-h-64 overflow-auto rounded bg-muted p-3 whitespace-pre-wrap">
{info.trim()}
              </pre>
              {error.stack && (
                <pre className="mt-2 max-h-64 overflow-auto rounded bg-muted p-3 whitespace-pre-wrap">
{error.stack}
                </pre>
              )}
            </details>
          )}

          <div className="flex gap-2 pt-2">
            <button
              onClick={this.handleReset}
              className="px-3 py-1.5 text-sm rounded border bg-background hover:bg-accent transition"
            >
              다시 시도
            </button>
            <button
              onClick={this.handleReload}
              className="px-3 py-1.5 text-sm rounded bg-primary text-primary-foreground hover:opacity-90 transition"
            >
              새로고침
            </button>
          </div>
        </div>
      </div>
    );
  }
}

function extractFailingComponent(componentStack: string | null): string | null {
  if (!componentStack) return null;
  // First line of React's componentStack like "    at Records (..."
  const line = componentStack.split("\n").map((l) => l.trim()).find(Boolean);
  if (!line) return null;
  const m = line.match(/^at\s+([A-Za-z0-9_$.]+)/);
  return m ? m[1] : line;
}

export default function RouteErrorBoundary({
  routeName,
  children,
}: {
  routeName: string;
  children: ReactNode;
}) {
  const location = useLocation();
  // Reset boundary when route changes by keying on pathname
  return (
    <ErrorBoundaryInner key={location.pathname} routeName={routeName}>
      {children}
    </ErrorBoundaryInner>
  );
}