{
  outputs = {
    nixpkgs,
    flake-utils,
    ...
  }: flake-utils.lib.eachDefaultSystem(system:
    let
      pkgs = import nixpkgs {
        inherit system;
      };
    in
    with pkgs;
    {
      devShells.default = mkShell {
        shellHook = ''
        '';
        buildInputs = [
          git
          awscli2
          nodejs_22
          pnpm
        ];
      };
    }
  );
}
