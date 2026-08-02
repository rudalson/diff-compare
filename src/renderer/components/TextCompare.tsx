import { useState, useEffect, useRef } from 'react';
import { FileText, FolderOpen, Save, RefreshCw, AlertCircle, ArrowLeftRight, Check, ChevronLeft, ChevronRight } from 'lucide-react';

interface TextCompareProps {
  initialLeftPath?: string;
  initialRightPath?: string;
  updateTitle: (title: string) => void;
}

interface DiffRow {
  type: 'unchanged' | 'added' | 'removed' | 'modified';
  leftLineNumber?: number;
  rightLineNumber?: number;
  leftContent: string;
  rightContent: string;
}

export default function TextCompare({ initialLeftPath, initialRightPath, updateTitle }: TextCompareProps) {
  const [leftPath, setLeftPath] = useState<string>(() => {
    return initialLeftPath || localStorage.getItem('tinydiff_last_left_file') || '';
  });
  const [rightPath, setRightPath] = useState<string>(() => {
    return initialRightPath || localStorage.getItem('tinydiff_last_right_file') || '';
  });
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [diffRows, setDiffRows] = useState<DiffRow[]>([]);
  const [stats, setStats] = useState<{added: number, removed: number, modified: number, unchanged: number}>({added: 0, removed: 0, modified: 0, unchanged: 0});
  const [leftSaveSuccess, setLeftSaveSuccess] = useState<boolean>(false);
  const [rightSaveSuccess, setRightSaveSuccess] = useState<boolean>(false);

  const leftPaneRef = useRef<HTMLDivElement>(null);
  const rightPaneRef = useRef<HTMLDivElement>(null);
  const leftLineNumbersRef = useRef<HTMLDivElement>(null);
  const rightLineNumbersRef = useRef<HTMLDivElement>(null);
  const activeScroll = useRef<'left' | 'right' | null>(null);

  const saveFileHistory = (side: 'left' | 'right', pathStr: string) => {
    if (!pathStr) return;
    const lastKey = side === 'left' ? 'tinydiff_last_left_file' : 'tinydiff_last_right_file';
    localStorage.setItem(lastKey, pathStr);
  };

  useEffect(() => {
    if (initialLeftPath && initialRightPath) {
      runCompare();
    }
  }, [initialLeftPath, initialRightPath]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') {
        return;
      }
      if (e.key === 'F5' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r')) {
        e.preventDefault();
        runCompare();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [leftPath, rightPath]);

  const selectLeftFile = async () => {
    const startPath = leftPath || localStorage.getItem('tinydiff_last_left_file') || undefined;
    const path = await window.api.selectFile(startPath);
    if (path) {
      setLeftPath(path);
      saveFileHistory('left', path);
      const filename = path.split(/[\\/]/).pop() || 'File';
      updateTitle(`TC: ${filename}`);
    }
  };

  const selectRightFile = async () => {
    const startPath = rightPath || localStorage.getItem('tinydiff_last_right_file') || undefined;
    const path = await window.api.selectFile(startPath);
    if (path) {
      setRightPath(path);
      saveFileHistory('right', path);
      if (leftPath) {
        const fileLeft = leftPath.split(/[\\/]/).pop() || 'File';
        const fileRight = path.split(/[\\/]/).pop() || 'File';
        updateTitle(`${fileLeft} ↔ ${fileRight}`);
      }
    }
  };

  const runCompare = async () => {
    if (!leftPath || !rightPath) {
      setError('Both file paths must be selected before comparing.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const result = await window.api.compareFiles(leftPath, rightPath);
      setDiffRows(result.rows);
      setStats(result.stats);
    } catch (err: any) {
      setError(err.message || 'Error occurred while comparing files.');
    } finally {
      setLoading(false);
    }
  };

  // Sync scroll implementation
  const handleScroll = (source: 'left' | 'right') => {
    const srcRef = source === 'left' ? leftPaneRef : rightPaneRef;
    const destRef = source === 'left' ? rightPaneRef : leftPaneRef;
    const srcNumsRef = source === 'left' ? leftLineNumbersRef : rightLineNumbersRef;
    const destNumsRef = source === 'left' ? rightLineNumbersRef : leftLineNumbersRef;

    if (activeScroll.current === source && srcRef.current && destRef.current) {
      destRef.current.scrollTop = srcRef.current.scrollTop;
      destRef.current.scrollLeft = srcRef.current.scrollLeft;
      
      if (srcNumsRef.current) srcNumsRef.current.scrollTop = srcRef.current.scrollTop;
      if (destNumsRef.current) destNumsRef.current.scrollTop = srcRef.current.scrollTop;
    }
  };

  const handleMouseEnter = (pane: 'left' | 'right') => {
    activeScroll.current = pane;
  };

  // Merge operations
  const handleMergeLine = (index: number, direction: 'left-to-right' | 'right-to-left') => {
    const updated = [...diffRows];
    const target = updated[index];

    if (direction === 'left-to-right') {
      target.rightContent = target.leftContent;
      // If it was removed on left but copied right, it means the right side now has this line
      if (target.type === 'removed') {
        target.type = 'unchanged';
      } else if (target.type === 'modified') {
        target.type = 'unchanged';
      }
    } else {
      target.leftContent = target.rightContent;
      // If it was added on right but copied left, it means the left side now has this line
      if (target.type === 'added') {
        target.type = 'unchanged';
      } else if (target.type === 'modified') {
        target.type = 'unchanged';
      }
    }
    setDiffRows(updated);
    recalcStats(updated);
  };

  const recalcStats = (rows: DiffRow[]) => {
    let added = 0;
    let removed = 0;
    let modified = 0;
    let unchanged = 0;

    for (const r of rows) {
      if (r.type === 'added') added++;
      else if (r.type === 'removed') removed++;
      else if (r.type === 'modified') modified++;
      else if (r.type === 'unchanged') unchanged++;
    }
    setStats({ added, removed, modified, unchanged });
  };

  const handleEditLine = (index: number, side: 'left' | 'right', text: string) => {
    const updated = [...diffRows];
    const target = updated[index];

    if (side === 'left') {
      target.leftContent = text;
    } else {
      target.rightContent = text;
    }

    // Mark as modified if they don't match
    if (target.leftContent !== target.rightContent) {
      target.type = 'modified';
    } else {
      target.type = 'unchanged';
    }

    setDiffRows(updated);
    recalcStats(updated);
  };

  const saveFile = async (side: 'left' | 'right') => {
    const path = side === 'left' ? leftPath : rightPath;
    if (!path) return;

    // Filter rows to extract content for file
    const content = diffRows
      .map(row => (side === 'left' ? row.leftContent : row.rightContent))
      // Filter out blanks that correspond to added/removed placeholders
      .filter((_, idx) => {
        const row = diffRows[idx];
        if (side === 'left') {
          // If it was 'added' (right only), it has no line number on left, meaning it shouldn't exist in left file
          return row.type !== 'added';
        } else {
          // If it was 'removed' (left only), it has no line number on right, meaning it shouldn't exist in right file
          return row.type !== 'removed';
        }
      })
      .join('\n');

    try {
      await window.api.writeFile(path, content);
      if (side === 'left') {
        setLeftSaveSuccess(true);
        setTimeout(() => setLeftSaveSuccess(false), 2000);
      } else {
        setRightSaveSuccess(true);
        setTimeout(() => setRightSaveSuccess(false), 2000);
      }
    } catch (err: any) {
      setError(`Failed to save: ${err.message}`);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '12px 16px' }}>
      
      {/* File Path Picker bar */}
      <div className="glass-panel" style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          
          {/* Left File Input */}
          <div style={{ flex: 1, display: 'flex', gap: '8px' }}>
            <input
              type="text"
              className="input-field"
              placeholder="Left File Path"
              value={leftPath}
              onChange={(e) => setLeftPath(e.target.value)}
              style={{ flex: 1, height: '34px', padding: '6px 10px', fontSize: '0.8rem' }}
            />
            <button className="btn" onClick={selectLeftFile} style={{ height: '34px', padding: '0 12px', fontSize: '0.8rem' }}>
              <FolderOpen size={14} />
              Browse
            </button>
          </div>

          <ArrowLeftRight size={16} className="text-slate-500" style={{ color: 'var(--text-muted)' }} />

          {/* Right File Input */}
          <div style={{ flex: 1, display: 'flex', gap: '8px' }}>
            <input
              type="text"
              className="input-field"
              placeholder="Right File Path"
              value={rightPath}
              onChange={(e) => setRightPath(e.target.value)}
              style={{ flex: 1, height: '34px', padding: '6px 10px', fontSize: '0.8rem' }}
            />
            <button className="btn" onClick={selectRightFile} style={{ height: '34px', padding: '0 12px', fontSize: '0.8rem' }}>
              <FolderOpen size={14} />
              Browse
            </button>
          </div>

          {/* Compare Button */}
          <button className="btn btn-primary" onClick={runCompare} disabled={loading} style={{ height: '34px', paddingLeft: '16px', paddingRight: '16px', fontSize: '0.8rem' }}>
            {loading ? <RefreshCw size={14} className="animate-spin" /> : <ArrowLeftRight size={14} />}
            Compare
          </button>

          {/* Refresh Button */}
          <button
            className="btn"
            onClick={runCompare}
            disabled={loading || !leftPath || !rightPath}
            style={{ height: '34px', padding: '0 14px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '6px' }}
            title="Refresh File Compare (F5 / Ctrl+R)"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            <span>Refresh</span>
          </button>
        </div>

        {error && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#ef4444', fontSize: '0.85rem' }}>
            <AlertCircle size={14} />
            <span>{error}</span>
          </div>
        )}
      </div>

      {/* Stats and Saves Panel */}
      {diffRows.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          
          {/* Left save button */}
          <button
            onClick={() => saveFile('left')}
            className="btn"
            style={{
              padding: '6px 12px',
              fontSize: '0.75rem',
              color: leftSaveSuccess ? '#10b981' : 'var(--text-primary)',
              borderColor: leftSaveSuccess ? '#10b981' : 'var(--border-color)',
            }}
          >
            {leftSaveSuccess ? <Check size={14} /> : <Save size={14} />}
            {leftSaveSuccess ? 'Left Saved!' : 'Save Left File'}
          </button>

          {/* Center Stats */}
          <div style={{ display: 'flex', gap: '16px', fontSize: '0.75rem' }}>
            <span style={{ color: 'var(--text-secondary)' }}>
              Unchanged: <strong style={{ color: 'var(--text-primary)' }}>{stats.unchanged}</strong>
            </span>
            <span style={{ color: 'var(--diff-removed-text)' }}>
              Removed: <strong>{stats.removed}</strong>
            </span>
            <span style={{ color: 'var(--diff-modified-text)' }}>
              Modified: <strong>{stats.modified}</strong>
            </span>
            <span style={{ color: 'var(--diff-added-text)' }}>
              Added: <strong>{stats.added}</strong>
            </span>
          </div>

          {/* Right save button */}
          <button
            onClick={() => saveFile('right')}
            className="btn"
            style={{
              padding: '6px 12px',
              fontSize: '0.75rem',
              color: rightSaveSuccess ? '#10b981' : 'var(--text-primary)',
              borderColor: rightSaveSuccess ? '#10b981' : 'var(--border-color)',
            }}
          >
            {rightSaveSuccess ? <Check size={14} /> : <Save size={14} />}
            {rightSaveSuccess ? 'Right Saved!' : 'Save Right File'}
          </button>
        </div>
      )}

      {/* Editor Panel Split Screen */}
      <div className="glass-panel" style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
        {diffRows.length === 0 ? (
          <div style={{ height: '100%', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', gap: '8px' }}>
            <FileText size={48} style={{ strokeWidth: 1.5 }} />
            <span>Select left and right files and click Compare to start.</span>
          </div>
        ) : (
          <div style={{ display: 'flex', width: '100%', height: '100%', overflow: 'hidden' }}>
            
            {/* LEFT EDITOR PANE */}
            <div
              style={{ flex: 1, display: 'flex', overflow: 'hidden', borderRight: '1px solid var(--border-color)' }}
            >
              {/* Left Line Numbers */}
              <div
                ref={leftLineNumbersRef}
                style={{
                  width: '45px',
                  backgroundColor: 'rgba(0,0,0,0.15)',
                  color: 'var(--text-muted)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.75rem',
                  textAlign: 'right',
                  paddingRight: '8px',
                  paddingTop: '10px',
                  userSelect: 'none',
                  overflow: 'hidden',
                  lineHeight: '22px',
                }}
              >
                {diffRows.map((row, idx) => (
                  <div key={idx} style={{ height: '22px' }}>
                    {row.type !== 'added' ? row.leftLineNumber : ''}
                  </div>
                ))}
              </div>

              {/* Left Content */}
              <div
                ref={leftPaneRef}
                onScroll={() => handleScroll('left')}
                onMouseEnter={() => handleMouseEnter('left')}
                style={{
                  flex: 1,
                  overflow: 'auto',
                  paddingTop: '10px',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.8rem',
                  lineHeight: '22px',
                  whiteSpace: 'pre',
                }}
              >
                {diffRows.map((row, idx) => {
                  let bg = 'transparent';
                  if (row.type === 'removed') bg = 'var(--diff-removed-bg)';
                  else if (row.type === 'modified') bg = 'var(--diff-modified-bg)';
                  
                  return (
                    <div
                      key={idx}
                      style={{
                        backgroundColor: bg,
                        minHeight: '22px',
                        paddingLeft: '12px',
                        paddingRight: '12px',
                        display: 'flex',
                        alignItems: 'center',
                      }}
                    >
                      {row.type !== 'added' ? (
                        <input
                          type="text"
                          value={row.leftContent}
                          onChange={(e) => handleEditLine(idx, 'left', e.target.value)}
                          style={{
                            border: 'none',
                            background: 'transparent',
                            color: 'inherit',
                            fontFamily: 'inherit',
                            fontSize: 'inherit',
                            width: '100%',
                            outline: 'none',
                            padding: 0,
                          }}
                        />
                      ) : (
                        <span style={{ color: 'var(--text-muted)', fontStyle: 'italic', opacity: 0.2 }}>~</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* MERGE BUTTONS COLUMN */}
            <div
              style={{
                width: '32px',
                backgroundColor: 'rgba(0,0,0,0.25)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                paddingTop: '10px',
                borderRight: '1px solid var(--border-color)',
                userSelect: 'none',
                lineHeight: '22px',
              }}
            >
              {diffRows.map((row, idx) => (
                <div
                  key={idx}
                  style={{
                    height: '22px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '2px',
                  }}
                >
                  {row.type !== 'unchanged' && (
                    <div style={{ display: 'flex' }}>
                      {/* Copy Right to Left */}
                      {row.type !== 'removed' && (
                        <button
                          onClick={() => handleMergeLine(idx, 'right-to-left')}
                          title="Copy line to Left"
                          style={{
                            border: 'none',
                            background: 'transparent',
                            cursor: 'pointer',
                            color: 'var(--diff-modified-text)',
                            padding: 0,
                            display: 'flex',
                          }}
                        >
                          <ChevronLeft size={12} />
                        </button>
                      )}
                      {/* Copy Left to Right */}
                      {row.type !== 'added' && (
                        <button
                          onClick={() => handleMergeLine(idx, 'left-to-right')}
                          title="Copy line to Right"
                          style={{
                            border: 'none',
                            background: 'transparent',
                            cursor: 'pointer',
                            color: 'var(--diff-modified-text)',
                            padding: 0,
                            display: 'flex',
                          }}
                        >
                          <ChevronRight size={12} />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* RIGHT EDITOR PANE */}
            <div
              style={{ flex: 1, display: 'flex', overflow: 'hidden' }}
            >
              {/* Right Line Numbers */}
              <div
                ref={rightLineNumbersRef}
                style={{
                  width: '45px',
                  backgroundColor: 'rgba(0,0,0,0.15)',
                  color: 'var(--text-muted)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.75rem',
                  textAlign: 'right',
                  paddingRight: '8px',
                  paddingTop: '10px',
                  userSelect: 'none',
                  overflow: 'hidden',
                  lineHeight: '22px',
                }}
              >
                {diffRows.map((row, idx) => (
                  <div key={idx} style={{ height: '22px' }}>
                    {row.type !== 'removed' ? row.rightLineNumber : ''}
                  </div>
                ))}
              </div>

              {/* Right Content */}
              <div
                ref={rightPaneRef}
                onScroll={() => handleScroll('right')}
                onMouseEnter={() => handleMouseEnter('right')}
                style={{
                  flex: 1,
                  overflow: 'auto',
                  paddingTop: '10px',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.8rem',
                  lineHeight: '22px',
                  whiteSpace: 'pre',
                }}
              >
                {diffRows.map((row, idx) => {
                  let bg = 'transparent';
                  if (row.type === 'added') bg = 'var(--diff-added-bg)';
                  else if (row.type === 'modified') bg = 'var(--diff-modified-bg)';
                  
                  return (
                    <div
                      key={idx}
                      style={{
                        backgroundColor: bg,
                        minHeight: '22px',
                        paddingLeft: '12px',
                        paddingRight: '12px',
                        display: 'flex',
                        alignItems: 'center',
                      }}
                    >
                      {row.type !== 'removed' ? (
                        <input
                          type="text"
                          value={row.rightContent}
                          onChange={(e) => handleEditLine(idx, 'right', e.target.value)}
                          style={{
                            border: 'none',
                            background: 'transparent',
                            color: 'inherit',
                            fontFamily: 'inherit',
                            fontSize: 'inherit',
                            width: '100%',
                            outline: 'none',
                            padding: 0,
                          }}
                        />
                      ) : (
                        <span style={{ color: 'var(--text-muted)', fontStyle: 'italic', opacity: 0.2 }}>~</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

          </div>
        )}
      </div>
    </div>
  );
}
