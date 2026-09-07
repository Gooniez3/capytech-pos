import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  Lock,
  User,
  Eye,
  EyeOff,
} from 'lucide-react';

import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

export function LoginPage() {
  const { login, loading } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [username, setUsername] =
    useState('');

  const [password, setPassword] =
    useState('');

  const [
    showPassword,
    setShowPassword,
  ] = useState(false);

  const [error, setError] =
    useState('');

  async function handleSubmit(
    e: React.FormEvent
  ) {
    e.preventDefault();

    setError('');

    if (
      !username.trim() ||
      !password
    ) {
      setError(
        'Please enter your username and password.'
      );

      return;
    }

    try {
      const user = await login(
        username,
        password
      );

      toast(
        `Welcome back, ${user.name}!`,
        'success'
      );

      navigate('/dashboard');
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Login failed. Please try again.'
      );
    }
  }

  return (
    <div className="flex min-h-screen">
      {/* =====================================================
          LEFT PANEL
          ===================================================== */}

      <div
        className="
          relative
          hidden
          w-[44%]
          flex-col
          justify-between
          overflow-hidden
          bg-slate-900
          p-12
          text-white
          lg:flex
          xl:p-14
        "
      >
        {/* Background decoration */}

        <div
          className="
            pointer-events-none
            absolute
            inset-0
            opacity-[0.08]
          "
          style={{
            backgroundImage:
              'radial-gradient(circle at 15% 85%, #3366ff 0%, transparent 42%), radial-gradient(circle at 88% 10%, #0ea5e9 0%, transparent 38%)',
          }}
        />

        {/* =====================================================
            BRAND
            ===================================================== */}

        <div className="relative">
          <div className="flex items-center gap-3">
            {/* Logo */}

            <div
              className="
                flex
                h-11
                w-11
                shrink-0
                items-center
                justify-center
                overflow-hidden
                rounded-xl
                bg-white
              "
            >
              <img
                src="/logo.png"
                alt="CapyTech"
                className="
                  h-full
                  w-full
                  object-contain
                  p-1.5
                "
              />
            </div>

            {/* Brand name */}

            <div className="min-w-0">
              <p
                className="
                  text-[18px]
                  font-bold
                  leading-tight
                  tracking-tight
                  text-white
                "
              >
                CapyTech
              </p>

              <p
                className="
                  mt-0.5
                  text-xs
                  font-medium
                  tracking-wide
                  text-slate-400
                "
              >
                Computer Accessories Store
              </p>
            </div>
          </div>
        </div>

        {/* =====================================================
            MAIN MARKETING CONTENT
            ===================================================== */}

        <div className="relative max-w-xl">
          {/* Eyebrow */}

          <p
            className="
              mb-4
              text-xs
              font-semibold
              uppercase
              tracking-[0.18em]
              text-brand-300
            "
          >
            Store Management
          </p>

          {/* Headline */}

          <h1
            className="
              max-w-lg
              text-[40px]
              font-bold
              leading-[1.15]
              tracking-[-0.035em]
              text-white
              xl:text-[44px]
            "
          >
            Built for daily
            <br />
            store operations.
          </h1>

          {/* Description */}

          <p
            className="
              mt-5
              max-w-lg
              text-[17px]
              font-medium
              leading-7
              text-slate-400
            "
          >
            Sell faster, manage stock
            accurately, and keep every
            transaction organized in one
            reliable system.
          </p>

          {/* Capabilities */}

          <div
            className="
              mt-9
              grid
              max-w-lg
              grid-cols-1
              gap-3
              xl:grid-cols-3
            "
          >
            {/* POS */}

            <div
              className="
                rounded-xl
                border
                border-slate-700/70
                bg-white/[0.035]
                px-4
                py-4
              "
            >
              <p
                className="
                  text-sm
                  font-semibold
                  text-white
                "
              >
                POS & Checkout
              </p>

              <p
                className="
                  mt-1.5
                  text-xs
                  leading-5
                  text-slate-500
                "
              >
                Fast sales and payment
                processing.
              </p>
            </div>

            {/* Inventory */}

            <div
              className="
                rounded-xl
                border
                border-slate-700/70
                bg-white/[0.035]
                px-4
                py-4
              "
            >
              <p
                className="
                  text-sm
                  font-semibold
                  text-white
                "
              >
                Inventory Control
              </p>

              <p
                className="
                  mt-1.5
                  text-xs
                  leading-5
                  text-slate-500
                "
              >
                Stock levels and product
                tracking.
              </p>
            </div>

            {/* Reports */}

            <div
              className="
                rounded-xl
                border
                border-slate-700/70
                bg-white/[0.035]
                px-4
                py-4
              "
            >
              <p
                className="
                  text-sm
                  font-semibold
                  text-white
                "
              >
                Sales Reporting
              </p>

              <p
                className="
                  mt-1.5
                  text-xs
                  leading-5
                  text-slate-500
                "
              >
                Clear performance and
                transaction data.
              </p>
            </div>
          </div>
        </div>

        {/* =====================================================
            FOOTER
            ===================================================== */}

        <p
          className="
            relative
            text-xs
            text-slate-500
          "
        >
          © 2026 CapyTech. All rights
          reserved.
        </p>
      </div>

      {/* =====================================================
          RIGHT PANEL
          ===================================================== */}

      <div
        className="
          flex
          flex-1
          items-start
          justify-center
          bg-slate-50
          px-6
          pb-8
          pt-20

          sm:items-center
          sm:py-10

          lg:p-6
        "
      >
        <div className="w-full max-w-sm">
          {/* =====================================================
              MOBILE BRAND
              ===================================================== */}

          <div
            className="
              mb-10
              flex
              items-center
              gap-3
              lg:hidden
            "
          >
            {/* Logo */}

            <div
              className="
                flex
                h-12
                w-12
                shrink-0
                items-center
                justify-center
                overflow-hidden
                rounded-xl
                bg-white
                shadow-sm
                ring-1
                ring-slate-200
              "
            >
              <img
                src="/logo.png"
                alt="CapyTech"
                className="
                  h-full
                  w-full
                  object-contain
                  p-1.5
                "
              />
            </div>

            {/* Brand */}

            <div className="min-w-0">
              <p
                className="
                  text-[18px]
                  font-bold
                  leading-tight
                  tracking-tight
                  text-slate-900
                "
              >
                CapyTech
              </p>

              <p
                className="
                  mt-0.5
                  text-xs
                  font-medium
                  text-slate-500
                "
              >
                Computer Accessories Store
              </p>
            </div>
          </div>

          {/* =====================================================
              HEADER
              ===================================================== */}

          <h2
            className="
              text-[26px]
              font-bold
              tracking-tight
              text-slate-900
              sm:text-2xl
            "
          >
            Sign in to your account
          </h2>

          <p
            className="
              mt-1.5
              text-sm
              leading-6
              text-slate-500
            "
          >
            Enter your credentials to access
            the dashboard.
          </p>

          {/* =====================================================
              LOGIN FORM
              ===================================================== */}

          <form
            onSubmit={handleSubmit}
            className="
              mt-7
              space-y-4
              sm:mt-8
            "
          >
            {/* Username */}

            <Input
              label="Username"
              name="username"
              value={username}
              onChange={(e) =>
                setUsername(
                  e.target.value
                )
              }
              placeholder="Enter your username"
              leftIcon={
                <User className="h-4 w-4" />
              }
              autoComplete="username"
            />

            {/* Password */}

            <Input
              label="Password"
              name="password"
              type={
                showPassword
                  ? 'text'
                  : 'password'
              }
              value={password}
              onChange={(e) =>
                setPassword(
                  e.target.value
                )
              }
              placeholder="Enter your password"
              leftIcon={
                <Lock className="h-4 w-4" />
              }
              rightIcon={
                <button
                  type="button"
                  onClick={() =>
                    setShowPassword(
                      (value) =>
                        !value
                    )
                  }
                  className="
                    text-slate-400
                    transition-colors
                    hover:text-slate-600
                  "
                  aria-label={
                    showPassword
                      ? 'Hide password'
                      : 'Show password'
                  }
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              }
              autoComplete="current-password"
            />

            {/* Error */}

            {error && (
              <div
                className="
                  rounded-lg
                  border
                  border-danger-200
                  bg-danger-50
                  px-3
                  py-2.5
                  text-sm
                  font-medium
                  text-danger-700
                "
              >
                {error}
              </div>
            )}

            {/* =================================================
                REMEMBER / FORGOT
                ================================================= */}

            <div
              className="
                flex
                items-center
                justify-between
                gap-4
                text-sm
              "
            >
              <label
                className="
                  flex
                  cursor-pointer
                  items-center
                  gap-2
                  text-slate-600
                "
              >
                <input
                  type="checkbox"
                  className="
                    rounded
                    border-slate-300
                    text-brand-600
                    focus:ring-brand-500
                  "
                />

                <span>
                  Remember me
                </span>
              </label>

              <button
                type="button"
                className="
                  whitespace-nowrap
                  font-semibold
                  text-brand-600
                  transition-colors
                  hover:text-brand-700
                "
              >
                Forgot password?
              </button>
            </div>

            {/* =================================================
                SIGN IN
                ================================================= */}

            <Button
              type="submit"
              fullWidth
              size="lg"
              loading={loading}
            >
              Sign In
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}