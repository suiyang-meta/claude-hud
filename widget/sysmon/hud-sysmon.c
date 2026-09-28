/* HUD for Claude · github.com/suiyang-meta/claude-hud · (c) 2026 Sui1491 · MIT */
/*
 * hud-sysmon — the system readings Node cannot make on its own (macOS only).
 *
 *   chip / SSD / battery temperature     IOHIDEventSystem (private, no root)
 *   memory pressure, swap                sysctl
 *   GPU busy %, and GPU time per process IOAccelerator + its user clients
 *   per-process memory and disk I/O      proc_pid_rusage (own user's processes)
 *   which app each process belongs to    responsibility (private, as Activity Monitor)
 *   a process's working directory        proc_pidinfo, for the pids asked about
 *
 * CPU per process is not read here: /bin/ps is setuid root and sees every
 * process, while proc_pid_rusage only sees this user's. SystemMonitor.js uses
 * ps for that.
 *
 * Protocol: one request per line on stdin, one JSON object per line on stdout.
 *   s [pid ...]   take a sample; the listed pids also report their cwd
 * EOF on stdin ends it, so it can never outlive the app that started it.
 *
 * Build: node sysmon/build.js (clang, arm64).
 */
#include <CoreFoundation/CoreFoundation.h>
#include <IOKit/IOKitLib.h>
#include <libproc.h>
#include <sys/resource.h>
#include <sys/sysctl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct __IOHIDEventSystemClient *IOHIDEventSystemClientRef;
typedef struct __IOHIDServiceClient *IOHIDServiceClientRef;
typedef struct __IOHIDEvent *IOHIDEventRef;
extern IOHIDEventSystemClientRef IOHIDEventSystemClientCreate(CFAllocatorRef);
extern int IOHIDEventSystemClientSetMatching(IOHIDEventSystemClientRef, CFDictionaryRef);
extern CFArrayRef IOHIDEventSystemClientCopyServices(IOHIDEventSystemClientRef);
extern IOHIDEventRef IOHIDServiceClientCopyEvent(IOHIDServiceClientRef, int64_t, int32_t, int64_t);
extern CFTypeRef IOHIDServiceClientCopyProperty(IOHIDServiceClientRef, CFStringRef);
extern double IOHIDEventGetFloatValue(IOHIDEventRef, int32_t);
extern pid_t responsibility_get_pid_responsible_for_pid(pid_t);

#define TEMP_EVENT 15   /* kIOHIDEventTypeTemperature */

static void jstr(const char *s) {
  putchar('"');
  for (; *s; s++) {
    unsigned char c = (unsigned char)*s;
    if (c == '"' || c == '\\') { putchar('\\'); putchar(c); }
    else if (c < 0x20) printf("\\u%04x", c);
    else putchar(c);
  }
  putchar('"');
}

static void jnum(double v) { if (v == v) printf("%.1f", v); else fputs("null", stdout); }

/* ---- temperature ---- */
static CFArrayRef sensors;

static void temp_init(void) {
  int page = 0xff00, usage = 5;   /* Apple vendor page, temperature sensor */
  CFNumberRef p = CFNumberCreate(NULL, kCFNumberIntType, &page);
  CFNumberRef u = CFNumberCreate(NULL, kCFNumberIntType, &usage);
  const void *k[] = { CFSTR("PrimaryUsagePage"), CFSTR("PrimaryUsage") }, *v[] = { p, u };
  CFDictionaryRef m = CFDictionaryCreate(NULL, k, v, 2, &kCFTypeDictionaryKeyCallBacks,
                                         &kCFTypeDictionaryValueCallBacks);
  IOHIDEventSystemClientRef c = IOHIDEventSystemClientCreate(kCFAllocatorDefault);
  if (c) {
    IOHIDEventSystemClientSetMatching(c, m);
    sensors = IOHIDEventSystemClientCopyServices(c);
  }
  CFRelease(m); CFRelease(p); CFRelease(u);
}

/* The sensors' names are Apple's own and undocumented; which die each "tdie"
   sits on is not published, so the chip is reported as its hottest point. */
static void temps(void) {
  double chip = NAN, ssd = NAN, battery = NAN;
  CFIndex n = sensors ? CFArrayGetCount(sensors) : 0;
  for (CFIndex i = 0; i < n; i++) {
    IOHIDServiceClientRef sc = (IOHIDServiceClientRef)CFArrayGetValueAtIndex(sensors, i);
    IOHIDEventRef e = IOHIDServiceClientCopyEvent(sc, TEMP_EVENT, 0, 0);
    if (!e) continue;
    double t = IOHIDEventGetFloatValue(e, TEMP_EVENT << 16);
    CFRelease(e);
    if (!(t > 5 && t < 130)) continue;   /* a few sensors report -21.6 and the like */
    char name[128] = "";
    CFStringRef nm = IOHIDServiceClientCopyProperty(sc, CFSTR("Product"));
    if (nm) { CFStringGetCString(nm, name, sizeof name, kCFStringEncodingUTF8); CFRelease(nm); }
    if (strcasestr(name, "NAND")) { if (!(ssd >= t)) ssd = t; }
    else if (strcasestr(name, "battery") || strcasestr(name, "gas gauge")) { if (!(battery >= t)) battery = t; }
    else if (strcasestr(name, "tcal")) continue;   /* calibration reference, not a reading */
    else if (!(chip >= t)) chip = t;
  }
  fputs("\"temp\":{\"chip\":", stdout); jnum(chip);
  fputs(",\"ssd\":", stdout); jnum(ssd);
  fputs(",\"battery\":", stdout); jnum(battery);
  putchar('}');
}

/* ---- memory ---- */
static void memory(void) {
  int level = -1, pressure = -1; size_t sz;
  unsigned long long total = 0;
  struct xsw_usage swap = { 0 };
  sz = sizeof level;    sysctlbyname("kern.memorystatus_level", &level, &sz, NULL, 0);
  sz = sizeof pressure; sysctlbyname("kern.memorystatus_vm_pressure_level", &pressure, &sz, NULL, 0);
  sz = sizeof total;    sysctlbyname("hw.memsize", &total, &sz, NULL, 0);
  sz = sizeof swap;     sysctlbyname("vm.swapusage", &swap, &sz, NULL, 0);
  printf("\"mem\":{\"freePct\":%d,\"pressure\":%d,\"total\":%llu,\"swapUsed\":%llu,\"swapTotal\":%llu}",
         level, pressure, total, (unsigned long long)swap.xsu_used, (unsigned long long)swap.xsu_total);
}

/* ---- GPU ---- */
static long long num_of(CFTypeRef v) {
  long long n = 0;
  if (v && CFGetTypeID(v) == CFNumberGetTypeID()) CFNumberGetValue(v, kCFNumberLongLongType, &n);
  return n;
}

#define MAX_CLIENTS 512
static void gpu(void) {
  long long util = -1;
  int pids[MAX_CLIENTS]; long long ns[MAX_CLIENTS]; int nc = 0;
  io_iterator_t it;
  if (IOServiceGetMatchingServices(MACH_PORT_NULL, IOServiceMatching("IOAccelerator"), &it) == KERN_SUCCESS) {
    io_registry_entry_t acc;
    while ((acc = IOIteratorNext(it))) {
      CFDictionaryRef ps = IORegistryEntryCreateCFProperty(acc, CFSTR("PerformanceStatistics"), NULL, 0);
      if (ps) {
        if (CFGetTypeID(ps) == CFDictionaryGetTypeID()) {
          long long u = num_of(CFDictionaryGetValue(ps, CFSTR("Device Utilization %")));
          if (u > util) util = u;
        }
        CFRelease(ps);
      }
      /* Each app that draws with the GPU holds a user client under the
         accelerator, and each client keeps a running total of GPU time. */
      io_iterator_t ci;
      if (IORegistryEntryCreateIterator(acc, kIOServicePlane, kIORegistryIterateRecursively, &ci) == KERN_SUCCESS) {
        io_registry_entry_t e;
        while ((e = IOIteratorNext(ci))) {
          CFStringRef who = IORegistryEntryCreateCFProperty(e, CFSTR("IOUserClientCreator"), NULL, 0);
          CFArrayRef use = IORegistryEntryCreateCFProperty(e, CFSTR("AppUsage"), NULL, 0);
          int pid = -1; char buf[96];
          if (who && CFGetTypeID(who) == CFStringGetTypeID()
              && CFStringGetCString(who, buf, sizeof buf, kCFStringEncodingUTF8)) sscanf(buf, "pid %d", &pid);
          if (pid > 0 && use && CFGetTypeID(use) == CFArrayGetTypeID()) {
            long long t = 0;
            for (CFIndex i = 0; i < CFArrayGetCount(use); i++) {
              CFDictionaryRef d = CFArrayGetValueAtIndex(use, i);
              if (d && CFGetTypeID(d) == CFDictionaryGetTypeID())
                t += num_of(CFDictionaryGetValue(d, CFSTR("accumulatedGPUTime")));
            }
            int j = 0;
            while (j < nc && pids[j] != pid) j++;
            if (j == nc && nc < MAX_CLIENTS) { pids[nc] = pid; ns[nc] = 0; nc++; }
            if (j < nc) ns[j] += t;
          }
          if (who) CFRelease(who);
          if (use) CFRelease(use);
          IOObjectRelease(e);
        }
        IOObjectRelease(ci);
      }
      IOObjectRelease(acc);
    }
    IOObjectRelease(it);
  }
  printf("\"gpu\":{\"util\":%lld,\"clients\":[", util);
  for (int i = 0; i < nc; i++) printf("%s[%d,%lld]", i ? "," : "", pids[i], ns[i]);
  fputs("]}", stdout);
}

/* ---- processes ---- */
static void procs(void) {
  int n = proc_listallpids(NULL, 0);
  if (n <= 0) { fputs("\"procs\":[]", stdout); return; }
  pid_t *pids = malloc(sizeof(pid_t) * (n + 64));
  n = proc_listallpids(pids, (int)(sizeof(pid_t) * (n + 64)));
  fputs("\"procs\":[", stdout);
  int first = 1;
  for (int i = 0; i < n; i++) {
    struct rusage_info_v4 r;
    /* Succeeds for this user's processes only; root's and other users' are
       left to ps, which the caller runs anyway. */
    if (proc_pid_rusage(pids[i], RUSAGE_INFO_V4, (rusage_info_t *)&r) != 0) continue;
    pid_t resp = responsibility_get_pid_responsible_for_pid(pids[i]);
    printf("%s[%d,%llu,%llu,%llu,%d]", first ? "" : ",", pids[i],
           (unsigned long long)r.ri_phys_footprint, (unsigned long long)r.ri_diskio_bytesread,
           (unsigned long long)r.ri_diskio_byteswritten, resp);
    first = 0;
  }
  putchar(']');
  free(pids);
}

static void cwds(char *rest) {
  fputs("\"cwd\":{", stdout);
  int first = 1;
  for (char *tok = strtok(rest, " \t\r\n"); tok; tok = strtok(NULL, " \t\r\n")) {
    int pid = atoi(tok);
    struct proc_vnodepathinfo vpi;
    if (pid <= 0 || proc_pidinfo(pid, PROC_PIDVNODEPATHINFO, 0, &vpi, sizeof vpi) != sizeof vpi) continue;
    printf("%s\"%d\":", first ? "" : ",", pid);
    jstr(vpi.pvi_cdir.vip_path);
    first = 0;
  }
  putchar('}');
}

int main(void) {
  temp_init();
  char line[8192];
  while (fgets(line, sizeof line, stdin)) {
    if (line[0] != 's') continue;
    putchar('{');
    temps();  putchar(',');
    memory(); putchar(',');
    gpu();    putchar(',');
    procs();  putchar(',');
    cwds(line + 1);
    fputs("}\n", stdout);
    fflush(stdout);
  }
  return 0;
}
