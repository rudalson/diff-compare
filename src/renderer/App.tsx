import { useState } from 'react';
import { Plus, X, GitCompare, FolderOpen, FileCode, Play, Sparkles } from 'lucide-react';
import FolderCompare from './components/FolderCompare';
import TextCompare from './components/TextCompare';

type TabType = 'home' | 'folder' | 'text';

interface Tab {
  id: string;
  title: string;
  type: TabType;
  leftPath?: string;
  rightPath?: string;
}

export default function App() {
  const [tabs, setTabs] = useState<Tab[]>([
    { id: 'home', title: 'Home', type: 'home' }
  ]);
  const [activeTabId, setActiveTabId] = useState<string>('home');

  const activeTab = tabs.find(t => t.id === activeTabId) || tabs[0];

  const addTab = (type: TabType, leftPath?: string, rightPath?: string) => {
    const id = `${type}-${Date.now()}`;
    const title = type === 'folder' ? 'Folder Compare' : 'Text Compare';
    const newTab: Tab = { id, title, type, leftPath, rightPath };
    setTabs([...tabs, newTab]);
    setActiveTabId(id);
  };

  const closeTab = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (id === 'home') return; // Keep home open

    const index = tabs.findIndex(t => t.id === id);
    const newTabs = tabs.filter(t => t.id !== id);
    setTabs(newTabs);

    if (activeTabId === id) {
      // Switch to previous or next tab
      const nextActiveIndex = Math.max(0, index - 1);
      setActiveTabId(newTabs[nextActiveIndex]?.id || 'home');
    }
  };

  const updateTabTitle = (id: string, newTitle: string) => {
    setTabs(prev => prev.map(t => t.id === id ? { ...t, title: newTitle } : t));
  };

  return (
    <div className="flex flex-col h-screen text-slate-100 font-sans" style={{ background: 'var(--bg-app)', display: 'flex', flexDirection: 'column', height: '100vh' }}>
      
      {/* Premium Header / Tab bar */}
      <header className="flex items-center select-none border-b" style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)', height: '48px', display: 'flex', alignItems: 'center' }}>
        
        {/* Logo */}
        <div className="flex items-center gap-2 px-4 border-r font-display font-semibold text-indigo-400" style={{ borderColor: 'var(--border-color)', display: 'flex', alignItems: 'center', height: '100%', gap: '8px' }}>
          <GitCompare size={18} className="text-indigo-400" />
          <span style={{ fontSize: '0.9rem', letterSpacing: '0.05em' }}>ANTIGRAVITY DIFF</span>
        </div>

        {/* Tab Items */}
        <div className="flex-1 flex h-full overflow-x-auto overflow-y-hidden" style={{ display: 'flex', height: '100%', flex: 1 }}>
          {tabs.map(tab => {
            const isActive = tab.id === activeTabId;
            return (
              <div
                key={tab.id}
                onClick={() => setActiveTabId(tab.id)}
                className={`flex items-center h-full px-4 border-r cursor-pointer transition-colors relative group`}
                style={{
                  backgroundColor: isActive ? 'var(--bg-active-tab)' : 'transparent',
                  borderColor: 'var(--border-color)',
                  display: 'flex',
                  alignItems: 'center',
                  paddingLeft: '16px',
                  paddingRight: '16px',
                  fontSize: '0.8rem',
                  fontWeight: isActive ? 600 : 400,
                  color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                  borderBottom: isActive ? '2px solid var(--accent-color)' : 'none',
                }}
              >
                {tab.type === 'folder' && <FolderOpen size={13} style={{ marginRight: '6px' }} />}
                {tab.type === 'text' && <FileCode size={13} style={{ marginRight: '6px' }} />}
                
                <span className="truncate max-w-[120px]">{tab.title}</span>
                
                {tab.id !== 'home' && (
                  <button
                    onClick={(e) => closeTab(tab.id, e)}
                    className="ml-2 hover:bg-slate-700/60 p-0.5 rounded transition-all opacity-40 group-hover:opacity-100"
                    style={{ border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex', marginLeft: '8px', color: 'var(--text-primary)' }}
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            );
          })}

          {/* New Tab Button */}
          <div className="flex items-center px-3 gap-1" style={{ display: 'flex', alignItems: 'center', paddingLeft: '12px' }}>
            <button
              onClick={() => addTab('folder')}
              title="New Folder Compare"
              style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: '4px', borderRadius: '4px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center' }}
              className="hover:bg-slate-800"
            >
              <FolderOpen size={16} />
            </button>
            <button
              onClick={() => addTab('text')}
              title="New Text Compare"
              style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: '4px', borderRadius: '4px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center' }}
              className="hover:bg-slate-800"
            >
              <FileCode size={16} />
            </button>
          </div>
        </div>
      </header>

      {/* Main Workspace */}
      <main className="flex-1 overflow-hidden" style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        
        {/* Render Tab Contents (Keep mounted, toggle display to preserve state) */}
        {tabs.map(tab => {
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              style={{
                display: isActive ? 'block' : 'none',
                height: '100%',
                width: '100%'
              }}
            >
              {tab.type === 'home' && (
                <div className="flex flex-col items-center justify-center h-full p-8" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '32px' }}>
                  <div className="glass-panel p-8 max-w-xl w-full text-center flex flex-col items-center" style={{ padding: '48px', maxWidth: '600px', width: '100%', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <div className="p-4 bg-indigo-500/10 rounded-2xl mb-6 text-indigo-400" style={{ padding: '16px', background: 'rgba(99, 102, 241, 0.1)', borderRadius: '16px', marginBottom: '24px', display: 'inline-flex' }}>
                      <Sparkles size={40} />
                    </div>
                    <h1 className="font-display font-bold text-3xl mb-2 text-transparent bg-clip-text bg-gradient-to-r from-indigo-300 via-indigo-100 to-indigo-400" style={{ fontSize: '2rem', marginBottom: '8px', fontFamily: 'var(--font-display)', fontWeight: 800 }}>
                      Antigravity Diff Compare
                    </h1>
                    <p className="text-slate-400 text-sm mb-8 max-w-md" style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '32px', lineHeight: 1.6 }}>
                      A premium, modern folder & file comparison utility. Scan directories, compare changes side-by-side, and sync differences easily.
                    </p>

                    <div className="grid grid-cols-2 gap-4 w-full" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', width: '100%' }}>
                      <button
                        onClick={() => addTab('folder')}
                        className="btn btn-primary flex-col items-center justify-center p-6 gap-3"
                        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '24px', gap: '12px', height: '100%' }}
                      >
                        <FolderOpen size={32} />
                        <div className="text-left" style={{ textAlign: 'center' }}>
                          <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>Folder Compare</div>
                          <div style={{ fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.7)', marginTop: '4px' }}>Scan & sync directory trees</div>
                        </div>
                      </button>

                      <button
                        onClick={() => addTab('text')}
                        className="btn flex-col items-center justify-center p-6 gap-3 hover:border-slate-600"
                        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '24px', gap: '12px', height: '100%' }}
                      >
                        <FileCode size={32} className="text-indigo-400" />
                        <div className="text-left" style={{ textAlign: 'center' }}>
                          <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>Text Compare</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '4px' }}>Line-by-line file diff & edit</div>
                        </div>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {tab.type === 'folder' && (
                <FolderCompare
                  initialLeftPath={tab.leftPath}
                  initialRightPath={tab.rightPath}
                  onOpenTextCompare={(left, right) => {
                    addTab('text', left, right);
                  }}
                  updateTitle={(title) => updateTabTitle(tab.id, title)}
                />
              )}

              {tab.type === 'text' && (
                <TextCompare
                  initialLeftPath={tab.leftPath}
                  initialRightPath={tab.rightPath}
                  updateTitle={(title) => updateTabTitle(tab.id, title)}
                />
              )}
            </div>
          );
        })}

      </main>
    </div>
  );
}
