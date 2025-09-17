/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { auth } from '@/lib/firebase';
import { onAuthStateChanged, signInAnonymously, GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { LoaderCircle } from 'lucide-react';
import { toast } from 'sonner';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (u) router.replace('/lobby');
    });
    return () => unsub();
  }, [router]);

  const handleGuest = async () => {
    setLoading(true);
    try { await signInAnonymously(auth); router.replace('/lobby'); }
    catch (e) { toast.error('Anonymous sign-in failed'); }
    finally { setLoading(false); }
  };
  const handleGoogle = async () => {
    setLoading(true);
    try { await signInWithPopup(auth, new GoogleAuthProvider()); router.replace('/lobby'); }
    catch (e) { toast.error('Google sign-in blocked. Please allow popups and CSP.'); }
    finally { setLoading(false); }
  };
  const handleEmailSignIn = async () => {
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      router.replace('/lobby');
    } catch (e) {
      toast.error('Email sign-in failed');
    } finally { setLoading(false); }
  };
  const handleEmailSignUp = async () => {
    setLoading(true);
    try {
      await createUserWithEmailAndPassword(auth, email.trim(), password);
      router.replace('/lobby');
    } catch (e) {
      toast.error('Sign up failed');
    } finally { setLoading(false); }
  };

  return (
    <div className="dark min-h-screen flex items-center justify-center bg-background text-foreground">
      <div className="w-full max-w-sm p-6 rounded-lg border bg-card shadow-sm">
        <div className="flex flex-col gap-4">
          <h1 className="text-2xl font-bold text-center">CLUTCHPARTY</h1>
          <p className="text-sm text-center text-muted-foreground">Sign in to continue</p>

          <label className="text-sm">Email</label>
          <div className="relative">
            <input value={email} onChange={(e)=>setEmail(e.target.value)} placeholder="you@example.com" type="email" className="w-full h-10 rounded-md border bg-transparent px-3" />
          </div>

          <label className="text-sm">Password</label>
          <div className="relative">
            <input value={password} onChange={(e)=>setPassword(e.target.value)} placeholder="••••••••" type="password" className="w-full h-10 rounded-md border bg-transparent px-3" />
          </div>

          <button disabled={loading} onClick={handleEmailSignIn} className="h-10 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50">Sign In</button>
          <button disabled={loading} onClick={handleEmailSignUp} className="h-10 rounded-md border hover:bg-accent disabled:opacity-50">Sign Up</button>

          <div className="relative my-2 text-center text-xs text-muted-foreground">
            <span className="px-2 bg-card">OR CONTINUE WITH</span>
          </div>

          <button disabled={loading} onClick={handleGoogle} className="h-10 rounded-md border hover:bg-accent disabled:opacity-50 flex items-center justify-center gap-2">
            <span>G</span> <span>Google</span>
          </button>

          <button disabled={loading} onClick={handleGuest} className="h-10 rounded-md text-primary hover:underline disabled:opacity-50">Sign In Anonymously</button>

          {loading && (
            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <LoaderCircle className="h-4 w-4 animate-spin" />
              <span>Processing...</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
