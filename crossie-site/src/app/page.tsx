export default function Home() {
  return (
    <main className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-blue-400 mb-4">Crossie</h1>
        <p className="text-slate-400 mb-8">Comment everywhere on the web</p>
        <a
          href="/auth"
          className="inline-block bg-blue-600 hover:bg-blue-500 text-white py-3 px-6 rounded-lg font-medium transition-colors"
        >
          Get Started
        </a>
      </div>
    </main>
  );
}