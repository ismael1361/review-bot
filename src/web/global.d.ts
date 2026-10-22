declare module "*.module.css" {
  const styles: { [className: string]: string };
  export = styles;
}

declare module "*.css";

declare module "*.module.scss" {
  const styles: { [className: string]: string };
  export = styles;
}

declare module "*.scss";
