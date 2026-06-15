import { useState } from 'react';
import { FolderOpen, ArrowRight, RefreshCw, AlertCircle, Copy, FileText, Folder, Check, FileCode, GitCompare, ChevronRight, ChevronDown } from 'lucide-react';

interface FolderCompareProps {
  onOpenTextCompare: (leftPath: string, rightPath: string) => void;
  updateTitle: (title: string) => void;
}

interface CompareRow {
  name: string;
  relativePath: string;
  isDirectory: boolean;
  leftExists: boolean;
  rightExists: boolean;
  leftSize: number;
  rightSize: number;
  leftMtime: number;
  rightMtime: number;
  leftFullPath: string;
  rightFullPath: string;
  status: 'identical' | 'different' | 'leftOnly' | 'rightOnly';
  depth: number;
}

export default function FolderCompare({ onOpenTextCompare, updateTitle }: FolderCompareProps) {
  const [leftPath, setLeftPath] = useState<string>('');
  const [rightPath, setRightPath] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [rows, setRows] = useState<CompareRow[]>([]);
  const [filter, setFilter] = useState<'all' | 'diff' | 'leftOnly' | 'rightOnly'>('all');
  const [error, setError] = useState<string | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());

  const toggleExpand = (path: string) => {
    setExpandedPaths(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const isRowVisible = (relativePath: string) => {
    const parts = relativePath.split('/');
    if (parts.length <= 1) return true; // Root nodes are always visible
    
    let currentParent = '';
    for (let i = 0; i < parts.length - 1; i++) {
      currentParent = currentParent ? `${currentParent}/${parts[i]}` : parts[i];
      if (!expandedPaths.has(currentParent)) {
        return false;
      }
    }
    return true;
  };

  const selectLeftFolder = async () => {
    const path = await window.api.selectDirectory();
    if (path) {
      setLeftPath(path);
      const folderName = path.split(/[\\/]/).pop() || 'Folder';
      updateTitle(`FC: ${folderName}`);
    }
  };

  const selectRightFolder = async () => {
    const path = await window.api.selectDirectory();
    if (path) {
      setRightPath(path);
      if (leftPath) {
        const folderNameLeft = leftPath.split(/[\\/]/).pop() || 'Folder';
        const folderNameRight = path.split(/[\\/]/).pop() || 'Folder';
        updateTitle(`${folderNameLeft} ↔ ${folderNameRight}`);
      }
    }
  };

  const runCompare = async () => {
    if (!leftPath || !rightPath) {
      setError('Both left and right directory paths must be specified.');
      return;
    }

    setLoading(true);
    setError(null);
    setExpandedPaths(new Set()); // Collapse all folders by default on fresh comparison

    try {
      const leftNodes = await window.api.scanDirectory(leftPath);
      const rightNodes = await window.api.scanDirectory(rightPath);

      const leftMap = new Map<string, FileNode>();
      leftNodes.forEach(node => leftMap.set(node.relativePath, node));

      const rightMap = new Map<string, FileNode>();
      rightNodes.forEach(node => rightMap.set(node.relativePath, node));

      // Combine all relative paths
      const allPathsSet = new Set<string>([...leftMap.keys(), ...rightMap.keys()]);
      const isDir = (relPath: string): boolean => {
        const node = leftMap.get(relPath) || rightMap.get(relPath);
        return node ? node.isDirectory : false;
      };

      const sortedPaths = Array.from(allPathsSet).sort((a, b) => {
        const aParts = a.split('/');
        const bParts = b.split('/');
        const minLen = Math.min(aParts.length, bParts.length);
        for (let i = 0; i < minLen; i++) {
          if (aParts[i] !== bParts[i]) {
            const relA = aParts.slice(0, i + 1).join('/');
            const relB = bParts.slice(0, i + 1).join('/');
            const dirA = isDir(relA);
            const dirB = isDir(relB);
            
            if (dirA !== dirB) {
              return dirA ? -1 : 1;
            }
            return aParts[i].localeCompare(bParts[i]);
          }
        }
        return a.length - b.length;
      });

      const comparedRows: CompareRow[] = sortedPaths.map(relPath => {
        const leftNode = leftMap.get(relPath);
        const rightNode = rightMap.get(relPath);

        const leftExists = !!leftNode;
        const rightExists = !!rightNode;

        const isDirectory = leftNode?.isDirectory ?? rightNode?.isDirectory ?? false;
        const depth = relPath.split('/').length - 1;

        const leftSize = leftNode?.size ?? 0;
        const rightSize = rightNode?.size ?? 0;
        const leftMtime = leftNode?.mtimeMs ?? 0;
        const rightMtime = rightNode?.mtimeMs ?? 0;

        const leftFullPath = leftNode?.path ?? `${leftPath}/${relPath}`;
        const rightFullPath = rightNode?.path ?? `${rightPath}/${relPath}`;

        let status: CompareRow['status'] = 'identical';

        if (leftExists && !rightExists) {
          status = 'leftOnly';
        } else if (!leftExists && rightExists) {
          status = 'rightOnly';
        } else if (isDirectory) {
          status = 'identical'; // Directories themselves don't differ in content
        } else {
          // If size or modification times are different
          const sizeDiff = leftSize !== rightSize;
          // Beyond Compare style - difference if size differs, or modified time differs
          // We can allow some tolerance in ms or just exact match
          const timeDiff = Math.abs(leftMtime - rightMtime) > 1000;
          if (sizeDiff || timeDiff) {
            status = 'different';
          }
        }

        const name = relPath.split('/').pop() || '';

        return {
          name,
          relativePath: relPath,
          isDirectory,
          leftExists,
          rightExists,
          leftSize,
          rightSize,
          leftMtime,
          rightMtime,
          leftFullPath,
          rightFullPath,
          status,
          depth,
        };
      });

      setRows(comparedRows);
    } catch (err: any) {
      setError(err.message || 'An error occurred during comparison.');
    } finally {
      setLoading(false);
    }
  };

  const handleSyncFile = async (row: CompareRow, direction: 'left-to-right' | 'right-to-left') => {
    try {
      if (row.isDirectory) {
        setError('Synchronizing full directories is not supported in this version. Please sync individual files.');
        return;
      }

      if (direction === 'left-to-right') {
        if (!row.leftExists) return;
        const content = await window.api.readFile(row.leftFullPath);
        await window.api.writeFile(row.rightFullPath, content);
      } else {
        if (!row.rightExists) return;
        const content = await window.api.readFile(row.rightFullPath);
        await window.api.writeFile(row.leftFullPath, content);
      }

      // Re-run comparison to update statuses
      await runCompare();
    } catch (err: any) {
      setError(`Sync failed: ${err.message}`);
    }
  };

  const filteredRows = rows.filter(row => {
    if (!isRowVisible(row.relativePath)) return false;
    if (filter === 'all') return true;
    if (filter === 'diff') return row.status === 'different';
    if (filter === 'leftOnly') return row.status === 'leftOnly';
    if (filter === 'rightOnly') return row.status === 'rightOnly';
    return true;
  });

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const formatDate = (mtimeMs: number) => {
    if (mtimeMs === 0) return '-';
    return new Date(mtimeMs).toLocaleString('ko-KR', {
      year: '2-digit',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '24px' }}>
      
      {/* Folder Picker bar */}
      <div className="glass-panel" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          
          {/* Left Folder Input */}
          <div style={{ flex: 1, display: 'flex', gap: '8px' }}>
            <input
              type="text"
              className="input-field"
              placeholder="Left Folder Path"
              value={leftPath}
              onChange={(e) => setLeftPath(e.target.value)}
              style={{ flex: 1 }}
            />
            <button className="btn" onClick={selectLeftFolder}>
              <FolderOpen size={16} />
              Browse
            </button>
          </div>

          <ArrowRight size={20} className="text-slate-500" style={{ color: 'var(--text-muted)' }} />

          {/* Right Folder Input */}
          <div style={{ flex: 1, display: 'flex', gap: '8px' }}>
            <input
              type="text"
              className="input-field"
              placeholder="Right Folder Path"
              value={rightPath}
              onChange={(e) => setRightPath(e.target.value)}
              style={{ flex: 1 }}
            />
            <button className="btn" onClick={selectRightFolder}>
              <FolderOpen size={16} />
              Browse
            </button>
          </div>

          {/* Compare Button */}
          <button className="btn btn-primary" onClick={runCompare} disabled={loading} style={{ height: '38px', paddingLeft: '20px', paddingRight: '20px' }}>
            {loading ? <RefreshCw size={16} className="animate-spin" /> : <GitCompare size={16} />}
            Compare
          </button>
        </div>

        {error && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#ef4444', fontSize: '0.85rem' }}>
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}
      </div>

      {/* Toolbar / Filters */}
      {rows.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          {/* Filter Buttons */}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => setFilter('all')}
              className={`btn ${filter === 'all' ? 'btn-primary' : ''}`}
              style={{ padding: '6px 12px', fontSize: '0.75rem' }}
            >
              All Files ({rows.length})
            </button>
            <button
              onClick={() => setFilter('diff')}
              className={`btn ${filter === 'diff' ? 'btn-primary' : ''}`}
              style={{ padding: '6px 12px', fontSize: '0.75rem', color: filter === 'diff' ? 'white' : 'var(--diff-modified-text)' }}
            >
              Differences ({rows.filter(r => r.status === 'different').length})
            </button>
            <button
              onClick={() => setFilter('leftOnly')}
              className={`btn ${filter === 'leftOnly' ? 'btn-primary' : ''}`}
              style={{ padding: '6px 12px', fontSize: '0.75rem', color: filter === 'leftOnly' ? 'white' : 'var(--diff-removed-text)' }}
            >
              Left Only ({rows.filter(r => r.status === 'leftOnly').length})
            </button>
            <button
              onClick={() => setFilter('rightOnly')}
              className={`btn ${filter === 'rightOnly' ? 'btn-primary' : ''}`}
              style={{ padding: '6px 12px', fontSize: '0.75rem', color: filter === 'rightOnly' ? 'white' : 'var(--diff-added-text)' }}
            >
              Right Only ({rows.filter(r => r.status === 'rightOnly').length})
            </button>
          </div>
          
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            Double click a file to open file comparison
          </div>
        </div>
      )}

      {/* Main Grid View */}
      <div className="glass-panel" style={{ flex: 1, overflow: 'hidden', borderRadius: '8px', display: 'flex', flexDirection: 'column' }}>
        {rows.length === 0 ? (
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifycontent: 'center', color: 'var(--text-muted)', gap: '8px', padding: '48px' }}>
            <FolderOpen size={48} style={{ strokeWidth: 1.5 }} />
            <span>Select folders and click Compare to list files.</span>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
            
            {/* Headers */}
            <div style={{ display: 'flex', background: 'rgba(0,0,0,0.25)', borderBottom: '1px solid var(--border-color)', fontWeight: 600, color: 'var(--text-secondary)', fontSize: '0.8rem', userSelect: 'none' }}>
              {/* Left Header (46% width) */}
              <div style={{ flex: '1', display: 'grid', gridTemplateColumns: '1fr 90px 140px', padding: '10px 16px' }}>
                <div>Left Folder Contents</div>
                <div style={{ textAlign: 'right' }}>Size</div>
                <div style={{ paddingLeft: '24px' }}>Modified</div>
              </div>
              
              {/* Actions Divider */}
              <div style={{ width: '80px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderLeft: '1px solid var(--border-color)', borderRight: '1px solid var(--border-color)', background: 'rgba(0,0,0,0.1)' }}>
                Sync
              </div>

              {/* Right Header (46% width) */}
              <div style={{ flex: '1', display: 'grid', gridTemplateColumns: '1fr 90px 140px', padding: '10px 16px' }}>
                <div>Right Folder Contents</div>
                <div style={{ textAlign: 'right' }}>Size</div>
                <div style={{ paddingLeft: '24px' }}>Modified</div>
              </div>
            </div>

            {/* List Body */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {filteredRows.map((row, idx) => {
                let rowBg = 'transparent';
                let textColor = 'var(--text-primary)';
                
                if (row.status === 'different') {
                  rowBg = 'var(--diff-modified-bg)';
                  textColor = 'var(--diff-modified-text)';
                } else if (row.status === 'leftOnly') {
                  rowBg = 'var(--diff-removed-bg)';
                  textColor = 'var(--diff-removed-text)';
                } else if (row.status === 'rightOnly') {
                  rowBg = 'var(--diff-added-bg)';
                  textColor = 'var(--diff-added-text)';
                }

                return (
                  <div
                    key={idx}
                    onDoubleClick={() => {
                      if (!row.isDirectory) {
                        onOpenTextCompare(row.leftFullPath, row.rightFullPath);
                      }
                    }}
                    onClick={() => {
                      if (row.isDirectory) {
                        toggleExpand(row.relativePath);
                      }
                    }}
                    style={{
                      display: 'flex',
                      borderBottom: '1px solid var(--border-color)',
                      backgroundColor: rowBg,
                      color: textColor,
                      fontSize: '0.8rem',
                      cursor: row.isDirectory ? 'pointer' : 'pointer',
                      alignItems: 'stretch'
                    }}
                    className="hover:bg-white/5 transition-colors"
                  >
                    {/* Left Side */}
                    <div style={{ flex: '1', display: 'grid', gridTemplateColumns: '1fr 90px 140px', padding: '8px 16px', alignItems: 'center' }}>
                      {row.leftExists ? (
                        <>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', paddingLeft: `${row.depth * 16}px`, minWidth: 0 }}>
                            {row.isDirectory ? (
                              <span style={{ display: 'flex', alignItems: 'center', width: '12px', flexShrink: 0 }}>
                                {expandedPaths.has(row.relativePath) ? (
                                  <ChevronDown size={12} style={{ color: 'var(--text-secondary)' }} />
                                ) : (
                                  <ChevronRight size={12} style={{ color: 'var(--text-secondary)' }} />
                                )}
                              </span>
                            ) : (
                              <div style={{ width: '12px', flexShrink: 0 }} />
                            )}
                            {row.isDirectory ? (
                              <Folder size={14} style={{ color: '#fbbf24', flexShrink: 0 }} />
                            ) : (
                              <FileText size={14} style={{ flexShrink: 0 }} />
                            )}
                            <span className="truncate" style={{ fontWeight: row.isDirectory ? 600 : 400 }}>{row.name}</span>
                          </div>
                          <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                            {!row.isDirectory ? formatSize(row.leftSize) : ''}
                          </div>
                          <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', paddingLeft: '24px' }}>
                            {formatDate(row.leftMtime)}
                          </div>
                        </>
                      ) : (
                        <>
                          <div style={{ opacity: 0.25, fontStyle: 'italic', paddingLeft: `${row.depth * 16}px` }}>
                            (No file on left)
                          </div>
                          <div></div>
                          <div></div>
                        </>
                      )}
                    </div>

                    {/* Actions Spacer/Buttons */}
                    <div style={{ width: '80px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', borderLeft: '1px solid var(--border-color)', borderRight: '1px solid var(--border-color)', background: 'rgba(0,0,0,0.1)' }}>
                      {!row.isDirectory && (
                        <>
                          <button
                            onClick={() => handleSyncFile(row, 'left-to-right')}
                            disabled={!row.leftExists}
                            title="Copy left file to right"
                            style={{
                              padding: '4px',
                              borderRadius: '4px',
                              background: 'rgba(255,255,255,0.05)',
                              border: '1px solid var(--border-color)',
                              cursor: row.leftExists ? 'pointer' : 'not-allowed',
                              color: 'var(--text-primary)',
                              display: 'flex',
                              alignItems: 'center'
                            }}
                          >
                            <ArrowRight size={12} />
                          </button>
                          <button
                            onClick={() => handleSyncFile(row, 'right-to-left')}
                            disabled={!row.rightExists}
                            title="Copy right file to left"
                            style={{
                              padding: '4px',
                              borderRadius: '4px',
                              background: 'rgba(255,255,255,0.05)',
                              border: '1px solid var(--border-color)',
                              cursor: row.rightExists ? 'pointer' : 'not-allowed',
                              color: 'var(--text-primary)',
                              display: 'flex',
                              alignItems: 'center'
                            }}
                          >
                            <ArrowRight size={12} style={{ transform: 'rotate(180deg)' }} />
                          </button>
                        </>
                      )}
                    </div>

                    {/* Right Side */}
                    <div style={{ flex: '1', display: 'grid', gridTemplateColumns: '1fr 90px 140px', padding: '8px 16px', alignItems: 'center' }}>
                      {row.rightExists ? (
                        <>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', paddingLeft: `${row.depth * 16}px`, minWidth: 0 }}>
                            {row.isDirectory ? (
                              <span style={{ display: 'flex', alignItems: 'center', width: '12px', flexShrink: 0 }}>
                                {expandedPaths.has(row.relativePath) ? (
                                  <ChevronDown size={12} style={{ color: 'var(--text-secondary)' }} />
                                ) : (
                                  <ChevronRight size={12} style={{ color: 'var(--text-secondary)' }} />
                                )}
                              </span>
                            ) : (
                              <div style={{ width: '12px', flexShrink: 0 }} />
                            )}
                            {row.isDirectory ? (
                              <Folder size={14} style={{ color: '#fbbf24', flexShrink: 0 }} />
                            ) : (
                              <FileText size={14} style={{ flexShrink: 0 }} />
                            )}
                            <span className="truncate" style={{ fontWeight: row.isDirectory ? 600 : 400 }}>{row.name}</span>
                          </div>
                          <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                            {!row.isDirectory ? formatSize(row.rightSize) : ''}
                          </div>
                          <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', paddingLeft: '24px' }}>
                            {formatDate(row.rightMtime)}
                          </div>
                        </>
                      ) : (
                        <>
                          <div style={{ opacity: 0.25, fontStyle: 'italic', paddingLeft: `${row.depth * 16}px` }}>
                            (No file on right)
                          </div>
                          <div></div>
                          <div></div>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

          </div>
        )}
      </div>
    </div>
  );
}

