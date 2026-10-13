/* Reusable (sigil desktop focus) extension for the pinned desktop host.
 * Query on the window/main thread after wait-frame polls GLFW events.
 * GLFW's current context is sigil-desktop's one application window.
 * No window/device is created here. The web shell uses DOM focus events.
 */
#include "sigil-internal.h"

#if !defined(__wasm__)
/* GLFW's stable public ABI, as Substratic's gamepad bridge uses it.
 * Avoid coupling this extension to a cached dependency's include path.
 */
typedef struct GLFWwindow GLFWwindow;
extern GLFWwindow *glfwGetCurrentContext(void);
extern int glfwGetWindowAttrib(GLFWwindow *window, int attrib);
#define GLFW_FOCUSED 0x00020001
#endif

static Value native_window_focused(SigilVM *vm, int argc, Value *args)
{
    (void)vm; (void)argc; (void)args;
#if defined(__wasm__)
    return SIGIL_FALSE;
#else
    GLFWwindow *window = glfwGetCurrentContext();
    return window && glfwGetWindowAttrib(window, GLFW_FOCUSED)
        ? SIGIL_TRUE : SIGIL_FALSE;
#endif
}

void sigil__init_signal_extensions(SigilVM *vm)
{
    SigilModule *module = sigil_begin_module(vm, "(sigil desktop focus)");
    if (!module) return;
    sigil_module_register_native(vm, "window-focused?", native_window_focused,
                                 SIGIL_ARITY_EXACT(0),
                                 "Whether the current desktop window has input focus; #f without a window");
    sigil_module_export(vm, "window-focused?");
    sigil_end_module(vm);
}
