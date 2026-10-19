;; A prebuilt Signal release with its complete Guix runtime closure. Run on
;; Phantom through scripts/package-linux; this does not compile the game.
;; -RR wraps the launcher for relocation, with PRoot as a fallback on hosts
;; that disable unprivileged user namespaces. Nothing is installed on the
;; player's system and no Guix invocation is needed when they launch it.
(use-modules (guix gexp)
             (guix profiles)
             (guix store)
             (gnu packages)
             (srfi srfi-1)
             (srfi srfi-13))

(define payload-directory (getenv "SIGNAL_NATIVE_PAYLOAD"))
(define build-stamp (getenv "SIGNAL_NATIVE_STAMP"))
(define elf-roots (string-tokenize (or (getenv "SIGNAL_NATIVE_ELF_ROOTS") "")))
(unless (and payload-directory (string-prefix? "/" payload-directory)
             build-stamp (not (string-null? build-stamp))
             (pair? elf-roots) (every direct-store-path? elf-roots))
  (error "Use scripts/package-linux with a stamped native release"))

(define raw-game
  (local-file payload-directory "signal-overdrive-payload" #:recursive? #t))

;; Copy into a build output so Guix registers references embedded in the
;; prebuilt ELF (including its exact interpreter/libc), rather than relying
;; on a source-directory import to discover that runtime closure.
(define game
  (computed-file
   "signal-overdrive-game"
   (with-imported-modules '((guix build utils))
     #~(begin
         (use-modules (guix build utils))
         (copy-recursively #$raw-game #$output)
         ;; Declare the measured ELF dependencies as inputs AND leave
         ;; explicit references in the output. This retains the original
         ;; loader/libc even if the packaging host uses a newer Guix channel.
         (call-with-output-file (string-append #$output "/ELF-RUNTIME-ROOTS")
           (lambda (port)
             (for-each (lambda (root) (display root port) (newline port))
                       (list #$@elf-roots))))))))

;; These are the libraries GLFW and miniaudio dlopen by soname. Keep the
;; driver stack together; libglvnd must not shadow Guix's Mesa GLX library.
(define runtime
  (profile
   (content
    (specifications->manifest
     '("mesa" "libx11" "libxrender" "libxcursor" "libxrandr"
       "libxinerama" "libxi" "libxext" "wayland" "libxkbcommon"
       "pulseaudio")))))

(define launcher
  (program-file
   "signal-overdrive"
   #~(begin
       (setenv "GUIX_ENVIRONMENT" #$runtime)
       ;; Assets are relative to the game's working directory. Saves still
       ;; go to the user's normal XDG data directory, outside the pack.
       (chdir #$game)
       (apply execl #$(file-append game "/bin/signal-overdrive")
              "signal-overdrive" (cdr (command-line))))))

(define bundle
  (computed-file
   "signal-overdrive-linux"
   (with-imported-modules '((guix build utils))
     #~(begin
         (use-modules (guix build utils))
         (mkdir-p (string-append #$output "/bin"))
         (mkdir-p (string-append #$output "/share"))
         (symlink #$launcher (string-append #$output "/bin/signal-overdrive"))
         (symlink #$game (string-append #$output "/share/signal-overdrive"))))))

(manifest
 (list
  (manifest-entry
   (name "signal-overdrive")
   (version build-stamp)
   (item bundle))))
