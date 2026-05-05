import { Outlet, useLocation } from 'react-router-dom';
import { HiveSidebar } from './HiveSidebar';
import { TopBar } from './TopBar';
import { AnimatePresence, motion } from 'framer-motion';

export function AppLayout() {
  const location = useLocation();

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      {/* Skip-to-content link for keyboard users; visually hidden until
          focused, then anchors `#main` so Tab can bypass the sidebar
          and jump straight to the page body. */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:rounded-md focus:bg-primary focus:text-primary-foreground focus:px-3 focus:py-1.5 focus:text-xs"
      >
        Skip to main content
      </a>
      <HiveSidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar />
        <main id="main" className="flex-1 overflow-auto scrollbar-thin">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.15, ease: 'easeOut' }}
              className="h-full"
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}
