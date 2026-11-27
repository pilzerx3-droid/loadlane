/** The Loadlane mark: a lime square and the name, as in the prototype. */
export function Logo() {
  return (
    <a
      href="/"
      className="flex items-center gap-2.5 rounded-control px-2 py-1 text-[17px] font-bold tracking-tight"
    >
      <span aria-hidden="true" className="block size-5 rounded-md bg-accent" />
      Loadlane
    </a>
  );
}
