import React, { useEffect, useState } from 'react';
import { Layers, ShieldCheck, Cpu, Code2, AlertTriangle, CheckCircle, ExternalLink, Compass } from 'lucide-react';
import { api } from '../api.ts';

export const BlockchainRoadmap: React.FC = () => {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    api.getBlockchainInfo().then(setData).catch(console.error);
  }, []);

  return (
    <div className="w-full max-w-xl mx-auto px-4 py-4 space-y-4">
      {/* Disclaimer / Token Reality Banner */}
      <div className="p-4 rounded-2xl bg-gradient-to-br from-slate-900 via-amber-950/20 to-slate-900 border border-amber-600/40 shadow-xl">
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-xl bg-amber-950/80 border border-amber-700/60 text-amber-400 shrink-0">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm sm:text-base font-bold text-amber-200">
              Clear Token &amp; Legal Classification
            </h2>
            <p className="text-xs text-amber-300/80 mt-1 leading-relaxed">
              CoinPulse coins are currently <strong>internal engagement points</strong>. They are <strong>NOT</strong> an active cryptocurrency, have no current monetary value, and cannot be traded on exchanges or redeemed for fiat currency.
            </p>
          </div>
        </div>
      </div>

      {/* EVM L2 Architecture Specification Card */}
      <div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-md space-y-3">
        <div className="flex items-center gap-2">
          <Layers className="w-5 h-5 text-cyan-400" />
          <h3 className="text-sm font-bold text-white">Target Blockchain Migration Blueprint</h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
          <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800/80">
            <div className="text-[10px] uppercase font-mono text-slate-400">Target Network</div>
            <div className="text-sm font-semibold text-cyan-300 mt-0.5">Polygon PoS / Base L2</div>
            <p className="text-[11px] text-slate-400 mt-1">EVM-compatible Layer 2 for micro-cent transaction fees &amp; 2-second finality.</p>
          </div>

          <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800/80">
            <div className="text-[10px] uppercase font-mono text-slate-400">Token Standard</div>
            <div className="text-sm font-semibold text-emerald-300 mt-0.5">ERC-20 (Capped &amp; Burnable)</div>
            <p className="text-[11px] text-slate-400 mt-1">Ticker: CPULSE with 18 decimals, fixed total supply cap, and deflationary burn.</p>
          </div>

          <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800/80">
            <div className="text-[10px] uppercase font-mono text-slate-400">Wallet Architecture</div>
            <div className="text-sm font-semibold text-purple-300 mt-0.5">Non-Custodial Web3 (EIP-1193)</div>
            <p className="text-[11px] text-slate-400 mt-1">Users bind their personal MetaMask / Coinbase Wallet. Server never touches private keys.</p>
          </div>

          <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800/80">
            <div className="text-[10px] uppercase font-mono text-slate-400">Claim &amp; Gas Model</div>
            <div className="text-sm font-semibold text-amber-300 mt-0.5">Merkle-Tree Cryptographic Vouchers</div>
            <p className="text-[11px] text-slate-400 mt-1">Server publishes Merkle root; users pay negligible L2 gas directly when claiming on-chain.</p>
          </div>
        </div>
      </div>

      {/* Security & Sybil Requirements */}
      <div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-md space-y-2.5">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-emerald-400" />
          <h3 className="text-sm font-bold text-white">Security &amp; Smart Contract Pre-Requisites</h3>
        </div>

        <ul className="space-y-2 text-xs text-slate-300">
          <li className="flex items-start gap-2">
            <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <span><strong>Multi-Sig Governance:</strong> Gnosis Safe 3-of-5 threshold required for any contract upgrades or minting caps.</span>
          </li>
          <li className="flex items-start gap-2">
            <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <span><strong>Independent Audit:</strong> OpenZeppelin or CertiK security audit before any mainnet contract deployment.</span>
          </li>
          <li className="flex items-start gap-2">
            <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <span><strong>Sybil / Bot Pruning:</strong> Multi-layer hardware device attestation &amp; proof-of-humanity checks prior to snapshot inclusion.</span>
          </li>
        </ul>
      </div>

      {/* Roadmap Timeline */}
      <div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-md space-y-3">
        <div className="flex items-center gap-2">
          <Compass className="w-5 h-5 text-sky-400" />
          <h3 className="text-sm font-bold text-white">Ecosystem Evolution Roadmap</h3>
        </div>

        <div className="space-y-3 text-xs">
          <div className="p-3 rounded-xl bg-cyan-950/30 border border-cyan-800/40 relative">
            <div className="flex items-center justify-between font-bold text-cyan-300">
              <span>Phase 1: Proof-of-Engagement Network (ACTIVE)</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-900 text-cyan-200">LIVE NOW</span>
            </div>
            <p className="text-slate-300 text-[11px] mt-1">
              Hourly server-side authoritative mining, referral incentive activation, and tamper-resistant transaction ledger.
            </p>
          </div>

          <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/60">
            <div className="flex items-center justify-between font-bold text-slate-200">
              <span>Phase 2: Enclosed Testnet &amp; Web3 Binding</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400">UPCOMING</span>
            </div>
            <p className="text-slate-400 text-[11px] mt-1">
              Polygon Amoy / Base Sepolia testnet faucet, non-custodial wallet binding, and sandbox claim tests.
            </p>
          </div>

          <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/60">
            <div className="flex items-center justify-between font-bold text-slate-200">
              <span>Phase 3: Mainnet TGE &amp; Token Claims</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400">FUTURE</span>
            </div>
            <p className="text-slate-400 text-[11px] mt-1">
              Final ledger snapshot verification, on-chain Merkle root deployment, and non-custodial token claiming.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
