"use client";

import { ethers } from "ethers";
import { useCallback, useEffect, useRef, useState } from "react";
import { ensureDiscovered, pickDetail, pickProvider, setChosenRdns, type Eip1193Provider } from "./wallet";
import { ARC_CHAIN_HEX, ARC_RPC, switchToArc } from "./arcNetwork";

// A deliberate "user pulled the plug" marker, mirrored into localStorage so a
// reload doesn't silently re-attach. Built from a session tag + a verb so the
// naming stays parallel with the rest of the studio plumbing.
const SESSION_TAG = "studio.session";
const FLAG_ON = "1";
const SEVERED_FLAG = `${SESSION_TAG}.severed`;

const onArc = (id: unknown) => (id as string).toLowerCase() === ARC_CHAIN_HEX.toLowerCase();

export function useWallet() {
  const [account, setAccount] = useState("");
  const [balance, setBalance] = useState("");
  const [chainOk, setChainOk] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const severedRef = useRef(false);
  const subRef = useRef<{ provider: Eip1193Provider; cleanup: () => void } | null>(null);

  const refreshBalance = useCallback(async (addr: string) => {
    try {
      const rpc = new ethers.JsonRpcProvider(ARC_RPC);
      const wei = await rpc.getBalance(addr);
      setBalance(parseFloat(ethers.formatEther(wei)).toFixed(3));
    } catch {
      setBalance("вЂ”");
    }
  }, []);

  const subscribe = useCallback(
    (inj: Eip1193Provider) => {
      if (!inj?.on) return;
      if (subRef.current?.provider === inj) return;
      subRef.current?.cleanup();
      const handleAccounts = (a: unknown) => {
        if (severedRef.current) return;
        const list = a as string[];
        if (list.length) {
          setAccount(list[0]);
          refreshBalance(list[0]);
        } else {
          setAccount("");
          setBalance("");
          setChainOk(false);
        }
      };
      const handleChain = (c: unknown) => setChainOk(onArc(c));
      inj.on("accountsChanged", handleAccounts);
      inj.on("chainChanged", handleChain);
      subRef.current = {
        provider: inj,
        cleanup: () => {
          inj.removeListener?.("accountsChanged", handleAccounts);
          inj.removeListener?.("chainChanged", handleChain);
        },
      };
    },
    [refreshBalance]
  );

  // Tear down: flip the severed flag, persist it, and blank local state.
  const disconnect = useCallback(() => {
    severedRef.current = true;
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(SEVERED_FLAG, FLAG_ON);
      } catch {
        /* ignore */
      }
    }
    setAccount("");
    setBalance("");
    setChainOk(false);
  }, []);

  // Bring a wallet online: clear the severed flag, discover, request accounts,
  // then nudge the wallet onto ARC and read back the resulting chain id.
  const connect = useCallback(async () => {
    severedRef.current = false;
    if (typeof window !== "undefined") {
      try {
        window.localStorage.removeItem(SEVERED_FLAG);
      } catch {
        /* ignore */
      }
    }
    await ensureDiscovered();
    const detail = pickDetail();
    const inj = detail?.provider;
    if (!inj) return;
    setChosenRdns(detail.rdns);
    setConnecting(true);
    try {
      const accs = (await inj.request({ method: "eth_requestAccounts" })) as string[];
      if (!accs?.length) return;
      setAccount(accs[0]);
      subscribe(inj);
      try {
        await switchToArc(inj);
      } catch {
        /* user declined the network switch */
      }
      try {
        const id = (await inj.request({ method: "eth_chainId" })) as string;
        setChainOk(onArc(id));
      } catch {
        setChainOk(false);
      }
      refreshBalance(accs[0]);
    } catch {
      /* user rejected */
    } finally {
      setConnecting(false);
    }
  }, [refreshBalance, subscribe]);

  // On mount: honour a previously-severed session, otherwise silently re-attach
  // to whatever account the wallet still exposes.
  useEffect(() => {
    if (typeof window !== "undefined" && window.localStorage.getItem(SEVERED_FLAG) === FLAG_ON) {
      severedRef.current = true;
    }
    (async () => {
      await ensureDiscovered();
      const inj = pickProvider();
      if (!inj) return;
      if (!severedRef.current) {
        try {
          const accs = (await inj.request({ method: "eth_accounts" })) as string[];
          if (accs.length) {
            setAccount(accs[0]);
            refreshBalance(accs[0]);
            inj
              .request({ method: "eth_chainId" })
              .then((id) => setChainOk(onArc(id)))
              .catch(() => {});
          }
        } catch {
          /* ignore */
        }
      }
      subscribe(inj);
    })();
    return () => {
      subRef.current?.cleanup();
      subRef.current = null;
    };
  }, [refreshBalance, subscribe]);

  return { account, balance, chainOk, connecting, connect, disconnect, refreshBalance };
}
