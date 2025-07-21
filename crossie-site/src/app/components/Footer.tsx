export default function Footer() {
  return (
    <footer className="border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
          <div className="flex flex-col sm:flex-row items-center gap-4 text-sm text-gray-600 dark:text-gray-400">
            <span>Created by Hashem Alomar</span>
            <span className="hidden sm:inline">•</span>
            <a 
              href="mailto:hashemalomarr@gmail.com"
              className="hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
            >
              hashemalomarr@gmail.com
            </a>
          </div>
          <div className="text-sm text-gray-500 dark:text-gray-500">
            © 2025 Crossie
          </div>
        </div>
      </div>
    </footer>
  );
} 