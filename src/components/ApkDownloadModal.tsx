import React from 'react';
import { Smartphone, Download, Github, CheckCircle2, X, ExternalLink, Terminal, ShieldCheck } from 'lucide-react';

interface ApkDownloadModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ApkDownloadModal: React.FC<ApkDownloadModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md">
      <div className="w-full max-w-lg rounded-3xl bg-gradient-to-b from-[#0f172a] via-[#09101f] to-[#070b14] border border-slate-700/80 p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto no-scrollbar">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 rounded-xl bg-emerald-950/80 border border-emerald-800 text-emerald-400">
              <Smartphone className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-bold text-white">Get CoinPulse Android APK</h2>
                <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800 font-mono font-bold">
                  GITHUB ACTIONS CI
                </span>
              </div>
              <p className="text-xs text-slate-400">Automated native APK builds via GitHub</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Highlight Banner */}
        <div className="p-3.5 rounded-2xl bg-cyan-950/30 border border-cyan-800/50 text-xs text-slate-300 leading-relaxed space-y-1">
          <div className="flex items-center gap-2 font-bold text-cyan-300">
            <Github className="w-4 h-4" />
            <span>Automated Cloud APK Pipeline Configured</span>
          </div>
          <p>
            A production-ready GitHub Actions workflow file has been created at <code className="text-cyan-400 font-mono">.github/workflows/build-apk.yml</code>. Whenever you push code or trigger the workflow, GitHub compiles the full native Android APK and hosts it under your repository's <strong>Actions Artifacts</strong>.
          </p>
        </div>

        {/* Step-by-Step Guide */}
        <div className="space-y-3 text-xs">
          <h3 className="font-mono text-slate-400 uppercase tracking-wider text-[11px]">
            3 Quick Steps to Download the APK:
          </h3>

          <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 space-y-1.5">
            <div className="flex items-center gap-2 font-bold text-slate-200">
              <span className="w-5 h-5 rounded-full bg-cyan-950 text-cyan-400 border border-cyan-800 flex items-center justify-center text-[10px] font-mono">
                1
              </span>
              <span>Push Your Code to GitHub</span>
            </div>
            <p className="text-slate-400 text-[11px] pl-7">
              Push your project repository to GitHub (branch <code className="text-slate-200">main</code> or <code className="text-slate-200">master</code>).
            </p>
          </div>

          <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 space-y-1.5">
            <div className="flex items-center gap-2 font-bold text-slate-200">
              <span className="w-5 h-5 rounded-full bg-cyan-950 text-cyan-400 border border-cyan-800 flex items-center justify-center text-[10px] font-mono">
                2
              </span>
              <span>GitHub Builds the APK Automatically</span>
            </div>
            <p className="text-slate-400 text-[11px] pl-7">
              Go to the <strong>Actions</strong> tab on your GitHub repository. The workflow <strong className="text-slate-200">&quot;Build Android APK&quot;</strong> will start automatically (takes ~2 minutes).
            </p>
          </div>

          <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 space-y-1.5">
            <div className="flex items-center gap-2 font-bold text-slate-200">
              <span className="w-5 h-5 rounded-full bg-cyan-950 text-cyan-400 border border-cyan-800 flex items-center justify-center text-[10px] font-mono">
                3
              </span>
              <span>Download &amp; Install on Android Device</span>
            </div>
            <p className="text-slate-400 text-[11px] pl-7">
              Click on the completed workflow run. Under <strong>Artifacts</strong>, click <strong className="text-emerald-400">&quot;CoinPulse-Android-APK&quot;</strong> to download the zip containing <code className="text-slate-200 font-mono">CoinPulse-v1.0-debug.apk</code> directly to your Android device or computer.
            </p>
          </div>
        </div>

        {/* Terminal Quick Commands */}
        <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 space-y-2 text-xs">
          <div className="flex items-center justify-between text-slate-400 font-mono text-[11px]">
            <span className="flex items-center gap-1.5">
              <Terminal className="w-3.5 h-3.5 text-cyan-400" />
              <span>To Build Locally via Command Line:</span>
            </span>
          </div>
          <pre className="p-2.5 rounded-xl bg-slate-900 font-mono text-[11px] text-cyan-300 overflow-x-auto select-all">
{`npm run build
npx cap sync android
cd android && ./gradlew assembleDebug`}
          </pre>
          <p className="text-[10px] text-slate-500">
            Output APK will be located at: <code className="text-slate-400">android/app/build/outputs/apk/debug/app-debug.apk</code>
          </p>
        </div>

        <button
          onClick={onClose}
          className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-200 transition-all"
        >
          Got it
        </button>
      </div>
    </div>
  );
};
