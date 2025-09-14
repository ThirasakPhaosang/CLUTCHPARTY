/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
"use client";

import React, { useState, useEffect, FC, forwardRef, HTMLAttributes, InputHTMLAttributes, ButtonHTMLAttributes, LabelHTMLAttributes } from 'react';
import { useRouter } from 'next/navigation';
import { auth, db } from '../lib/firebase';
// Fix: Import `updateDoc` from 'firebase/firestore' to resolve the 'Cannot find name' error.
import { doc, setDoc, serverTimestamp, getDoc, updateDoc } from 'firebase/firestore';
import { toast } from "sonner";

// Firebase imports
import { 
  onAuthStateChanged, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword,
  signInAnonymously, 
  signInWithPopup, 
  GoogleAuthProvider,
  User
} from 'firebase/auth';

import { cva, type VariantProps } from "class-variance-authority";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { Mail, KeyRound, LoaderCircle } from "lucide-react";

// --- UTILS ---
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- UI COMPONENTS ---
const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  };

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("rounded-lg border bg-card text-card-foreground shadow-sm", className)}
      {...props}
    />
  )
);
Card.displayName = "Card";

const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-col space-y-1.5 p-6", className)} {...props} />
  )
);
CardHeader.displayName = "CardHeader";

const CardTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3 ref={ref} className={cn("text-2xl font-semibold leading-none tracking-tight", className)} {...props} />
  )
);
CardTitle.displayName = "CardTitle";

const CardDescription = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
  )
);
CardDescription.displayName = "CardDescription";

const CardContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
  )
);
CardContent.displayName = "CardContent";

type InputProps = InputHTMLAttributes<HTMLInputElement>;

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

const Label = forwardRef<HTMLLabelElement, LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, ...props }, ref) => (
    <label
      ref={ref}
      className={cn(
        "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
        className
      )}
      {...props}
    />
  )
);
Label.displayName = "Label";

// --- FIREBASE CONFIG & INIT ---
const googleProvider = new GoogleAuthProvider();

const toMessage = (err: unknown): string => {
  if (err && typeof err === 'object' && 'message' in err) {
    const message = (err as { message?: string }).message || "An unknown error occurred.";
    // Clean up Firebase error codes
    return message.replace(/Firebase: |\(auth\/.*\)\.?/g, '').trim();
  }
  return "Something went wrong. Please try again.";
};

const createOrUpdateUserProfile = async (user: User) => {
    const userDocRef = doc(db, "users", user.uid);
    const userDocSnap = await getDoc(userDocRef);

    if (!userDocSnap.exists()) {
        const tag = `#${String(Math.floor(1000 + Math.random() * 9000))}`;
        await setDoc(userDocRef, {
            uid: user.uid,
            email: user.email,
            displayName: user.isAnonymous ? 'Guest' : user.displayName,
            tag: user.isAnonymous || user.displayName ? tag : null, // Give anon users and google users a tag
            createdAt: serverTimestamp(),
            friends: [],
            status: 'online',
            lastSeen: serverTimestamp()
        });
    } else {
        await updateDoc(userDocRef, {
            status: 'online',
            lastSeen: serverTimestamp()
        })
    }
}


// --- AUTH COMPONENTS ---

const LoginPage: FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);

  const handleAuthAction = async (action: 'login' | 'signup') => {
    if (!email || !password) {
      setError("Please enter both email and password.");
      return;
    }
    setError(null);
    setLoading(action);
    try {
      if (action === 'login') {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        await createOrUpdateUserProfile(userCredential.user);
      }
    } catch (err: unknown) {
      const msg = toMessage(err);
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(null);
    }
  };

  const handleGoogleSignIn = async () => {
    setError(null);
    setLoading('google');
    try {
      const result = await signInWithPopup(auth, googleProvider);
      await createOrUpdateUserProfile(result.user);
    } catch (err: unknown) {
        const msg = toMessage(err);
        setError(msg);
        toast.error(msg);
    } finally {
      setLoading(null);
    }
  };

  const handleAnonymousSignIn = async () => {
    setError(null);
    setLoading('anonymous');
    try {
        const result = await signInAnonymously(auth);
        await createOrUpdateUserProfile(result.user);
    } catch (err: unknown) {
        const msg = toMessage(err);
        setError(msg);
        toast.error(msg);
    } finally {
      setLoading(null);
    }
  };

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>CLUTCHPARTY</CardTitle>
        <CardDescription>Sign in to continue</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input 
                id="email" 
                type="email" 
                placeholder="you@example.com" 
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <div className="relative">
              <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input 
                id="password" 
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAuthAction('login')}
                className="pl-10"
              />
            </div>
          </div>
          {error && <p className="text-sm text-destructive text-center">{error}</p>}
          <div className="flex flex-col space-y-2">
            <Button onClick={() => handleAuthAction('login')} disabled={!!loading}>
              {loading === 'login' && <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />}
              Sign In
            </Button>
            <Button variant="secondary" onClick={() => handleAuthAction('signup')} disabled={!!loading}>
              {loading === 'signup' && <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />}
              Sign Up
            </Button>
          </div>
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">Or continue with</span>
            </div>
          </div>
          <Button variant="outline" className="w-full" onClick={handleGoogleSignIn} disabled={!!loading}>
            {loading === 'google' ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : 
            <svg className="mr-2 h-4 w-4" aria-hidden="true" focusable="false" data-prefix="fab" data-icon="google" role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 488 512"><path fill="currentColor" d="M488 261.8C488 403.3 381.5 512 244 512 110.3 512 0 398.8 0 256S110.3 0 244 0c77.2 0 142.3 28.5 195.4 73.8L391.1 126.8c-29.9-28.5-69.5-46.5-121.7-46.5-94.8 0-172.2 77.4-172.2 172.2s77.4 172.2 172.2 172.2c108.4 0 151.2-86.4 155.6-128.2H244v-94.2h244z"></path></svg>
            }
            Google
          </Button>
          <Button variant="ghost" className="w-full" onClick={handleAnonymousSignIn} disabled={!!loading}>
            {loading === 'anonymous' && <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />}
            Sign In Anonymously
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

// --- MAIN PAGE COMPONENT ---
export default function Home() {
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (currentUser) {
        router.push('/lobby');
      } else {
        setLoading(false);
      }
    });
    return () => unsubscribe();
  }, [router]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <LoaderCircle className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="font-sans flex items-center justify-center min-h-screen p-4 bg-background dark">
      <LoginPage />
    </div>
  );
}